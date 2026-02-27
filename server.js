const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const DATA_FILE = '/tmp/user_data.json'; // В Render лучше использовать папку /tmp для временных файлов
const API_KEY = process.env.GEMINI_KEY; 

let currentModel = "models/gemini-1.5-flash"; // Указываем модель напрямую для скорости

const loadData = () => {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE));
            if (!data.consumedToday) data.consumedToday = { cal: 0, p: 0, f: 0, c: 0 };
            if (!data.logs) data.logs = [];
            return data;
        } catch (e) { return { profile: null, dailyLimit: 2100, consumedToday: { cal: 0, p: 0, f: 0, c: 0 }, logs: [] }; }
    }
    return { profile: null, dailyLimit: 2100, consumedToday: { cal: 0, p: 0, f: 0, c: 0 }, logs: [] };
};

const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
let userData = loadData();

async function askGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${currentModel}:generateContent?key=${API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    try {
        // Используем встроенный в Node.js 18+ fetch (не требует node-fetch)
        const response = await fetch(url, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (e) { 
        console.error("AI Error:", e);
        return null; 
    }
}

app.post('/save-profile', (req, res) => {
    const { gender, weight, height, age, goal } = req.body;
    let bmr = (10 * weight) + (6.25 * height) - (5 * age);
    bmr = (gender === 'male') ? bmr + 5 : bmr - 161;
    bmr *= 1.2;
    if (goal === 'lose') bmr -= 500;
    if (goal === 'gain') bmr += 500;
    userData.profile = req.body;
    userData.dailyLimit = Math.round(bmr);
    saveData(userData);
    res.json(userData);
});

app.get('/welcome-advice', async (req, res) => {
    if (!userData.profile) return res.json({ text: "Привет! Заполни профиль в настройках." });
    const p = userData.profile;
    const prompt = `Ты тренер. Вес ${p.weight}, цель ${p.goal}. Дай 1 короткий совет.`;
    const text = await askGemini(prompt);
    const finalMsg = text || "Данные приняты! Жду отчет о первом приеме пищи.";
    userData.logs.push({ role: 'ai', text: finalMsg });
    saveData(userData);
    res.json({ text: finalMsg });
});

app.post('/analyze-chat', async (req, res) => {
    const prompt = `Диетолог. Юзер: ${JSON.stringify(userData.profile)}. Еда: "${req.body.text}". STATS{"cal":0,"p":0,"f":0,"c":0} и краткий совет.`;
    userData.logs.push({ role: 'user', text: req.body.text });
    const aiResponse = await askGemini(prompt);
    if (aiResponse) {
        let statsMatch = aiResponse.match(/STATS({.*?})/);
        if (statsMatch) {
            const stats = JSON.parse(statsMatch[1]);
            userData.consumedToday.cal += (Number(stats.cal) || 0);
            userData.consumedToday.p += (Number(stats.p) || 0);
            userData.consumedToday.f += (Number(stats.f) || 0);
            userData.consumedToday.c += (Number(stats.c) || 0);
        }
        let cleanText = aiResponse.replace(/STATS{.*?}/, "").trim();
        userData.logs.push({ role: 'ai', text: cleanText });
        saveData(userData);
        res.json({ text: cleanText, userData });
    }
});

app.get('/get-advice', async (req, res) => {
    const advice = await askGemini("Дай короткий фитнес-совет на сегодня.");
    res.json({ advice: advice || "Пей больше воды!" });
});

app.get('/get-data', (req, res) => res.json(userData));

app.post('/reset', (req, res) => { 
    userData.consumedToday = { cal: 0, p: 0, f: 0, c: 0 }; 
    userData.logs = []; 
    saveData(userData); 
    res.json(userData); 
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Coach AI is live on port ${PORT}`);
});