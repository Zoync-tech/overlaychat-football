require("dotenv").config();
const https = require('https');
const admin = require("firebase-admin");
const util = require("util");

const getTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

console.log = (...args) => { process.stdout.write(`[${getTimestamp()}] ` + util.format(...args) + "\n"); };
console.error = (...args) => { process.stderr.write(`[${getTimestamp()}] ` + util.format(...args) + "\n"); };

const fetchESPN = () =>
  new Promise((resolve, reject) => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?t=${Date.now()}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(JSON.parse(body));
      });
    }).on('error', reject);
  });

const setupFirebase = () => {
  try {
    const defaultVal = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!defaultVal) throw new Error("No FIREBASE_SERVICE_ACCOUNT");
    const serviceAccount = JSON.parse(defaultVal);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
      });
    }
  } catch (err) {
    console.error("Failed to configure Firebase: ", err.message);
    process.exit(1);
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const runMonitor = async () => {
  console.log("=== STARTING FIFA AUTOMATION MONITOR ===");
  setupFirebase();
  const db = admin.database();
  const BASE_ROOM = process.env.FIREBASE_ROOM || "fifa";

  while (true) {
    try {
      const data = await fetchESPN();
      const events = data.events || [];

      // Find all active matches first
      let targetEvents = events.filter(e => e.status.type.state === 'in');
      
      // If no active matches, find all upcoming pre-matches
      if (targetEvents.length === 0) {
        targetEvents = events.filter(e => e.status.type.state === 'pre');
      }
      
      if (targetEvents.length === 0) {
        console.log("No active or upcoming matches found today on ESPN. Using CSV Fallback.");
        
        const fs = require('fs');
        const path = require('path');
        const csvPath = path.join(__dirname, '../schedule_2026_fifa.csv');
        if (fs.existsSync(csvPath)) {
            const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter(Boolean);
            if (lines.length > 1) {
                // Grab the first match from CSV
                const matchLine = lines[1]; 
                const parts = matchLine.split(',');
                if (parts.length >= 6) {
                    const home = parts[3];
                    const away = parts[4];
                    const title = parts[5].trim();
                    
                    targetEvents.push({
                        name: title,
                        status: { type: { state: 'pre', description: 'Scheduled' } },
                        competitions: [{
                            competitors: [
                                { homeAway: 'home', team: { name: home }, score: "0" },
                                { homeAway: 'away', team: { name: away }, score: "0" }
                            ]
                        }]
                    });
                }
            }
        }

        if (targetEvents.length === 0) {
            console.log("No matches in CSV either. Exiting.");
            break;
        }
      }

      for (let i = 0; i < targetEvents.length; i++) {
        const targetEvent = targetEvents[i];
        const comp = targetEvent.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');

        const teamA = home.team.name;
        const teamB = away.team.name;
        const scoreA = home.score || "0";
        const scoreB = away.score || "0";
        const matchState = targetEvent.status.type.description; 
        const matchTitle = targetEvent.name;

        // Room mapping: first match goes to fifa1, second to fifa2, etc.
        const roomName = `${BASE_ROOM}${i + 1}`;
        console.log(`[Match ${i + 1}] -> ${roomName} | ${matchTitle} | State: ${matchState} | Score: ${teamA} ${scoreA} - ${scoreB} ${teamB}`);

        const updateData = {
          matchTitle,
          teamA,
          teamB,
          scoreA,
          scoreB,
          matchState,
          updatedAt: admin.database.ServerValue.TIMESTAMP
        };

        // Update the numbered room (e.g., fifa1, fifa2)
        await db.ref(`rooms/${roomName}/meta`).update(updateData);

        // Alias the first match to the base room (e.g., fifa) so ?r=fifa still works
        if (i === 0) {
          await db.ref(`rooms/${BASE_ROOM}/meta`).update(updateData);
        }
      }

      // Check if all targeted events have ended
      const allEnded = targetEvents.every(e => e.status.type.state === 'post');
      if (allEnded) {
        console.log("Matches have ended.");
        await sleep(60 * 1000); 
        continue; 
      }

      // Poll every 30 seconds if any match is live, otherwise every 2 minutes
      const isAnyLive = targetEvents.some(e => e.status.type.state === 'in');
      const waitTime = isAnyLive ? 30000 : 120000;
      await sleep(waitTime);

    } catch (err) {
      console.error("[Error] ", err.message);
      await sleep(60000);
    }
  }

  console.log("=== FIFA AUTOMATION MONITOR FINISHED ===");
  process.exit(0);
};

runMonitor();
