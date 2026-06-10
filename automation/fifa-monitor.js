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
        // We will push to the configured database or let the default kick in if databaseURL is not provided
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
  const ROOM = process.env.FIREBASE_ROOM || "fifa";

  console.log(`[Firebase] Target Room: ${ROOM}`);

  while (true) {
    try {
      const data = await fetchESPN();
      const events = data.events || [];

      // Find an active match, or the next scheduled match today
      let targetEvent = events.find(e => e.status.type.state === 'in');
      if (!targetEvent) {
        targetEvent = events.find(e => e.status.type.state === 'pre');
      }
      
      if (!targetEvent) {
        console.log("No active or upcoming matches found today. Exiting.");
        break; // End action if no matches left today
      }

      const comp = targetEvent.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');

      const teamA = home.team.name;
      const teamB = away.team.name;
      const scoreA = home.score || "0";
      const scoreB = away.score || "0";
      const matchState = targetEvent.status.type.description; // e.g. "Halftime", "Full Time"
      const matchTitle = targetEvent.name;

      console.log(`[Match] ${matchTitle} | State: ${matchState} | Score: ${teamA} ${scoreA} - ${scoreB} ${teamB}`);

      await db.ref(`rooms/${ROOM}/meta`).update({
        matchTitle,
        teamA,
        teamB,
        scoreA,
        scoreB,
        matchState,
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });

      if (targetEvent.status.type.state === 'post') {
        console.log("Match has ended.");
        // If there are other matches today, the loop will pick the next one up on next iteration
        await sleep(60 * 1000); 
        continue; 
      }

      // Poll every 30 seconds if live, otherwise every 2 minutes if pre-match
      const waitTime = targetEvent.status.type.state === 'in' ? 30000 : 120000;
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
