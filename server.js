const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const DATA_FILE = './user_data.json';
const API_KEY = process.env.GEMINI_KEY;

let currentModel = ""; 

async function findWorkingModel() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (data.models) {
            const found = data.models.find(m => m.supportedGenerationMethods.includes("generateContent"));
            if (found) { currentModel = found.name; return true; }
        }
        return false;
    } catch (e) { return false; }
}

const loadData = () => {
    if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        if (!data.consumedToday) data.consumedToday = { cal: 0, p: 0, f: 0, c: 0 };
        if (!data.logs) data.logs = [];
        return data;
    }
    return { profile: null, dailyLimit: 2100, consumedToday: { cal: 0, p: 0, f: 0, c: 0 }, logs: [] };
};

const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
let userData = loadData();

// ИСПРАВЛЕННАЯ ФУНКЦИЯ askGemini
async function askGemini(prompt) {
    if (!currentModel) await findWorkingModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/${currentModel}:generateContent?key=${API_KEY}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    
    try {
        const response = await fetch(url, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        // ПРОВЕРКА НАЛИЧИЯ ОТВЕТА (защита от TypeError)
        if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
            return data.candidates[0].content.parts[0].text;
        } else {
            console.error("API Response structure invalid:", JSON.stringify(data));
            return null;
        }
    } catch (e) { 
        console.error("AI Network Error:", e.message);
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
    if (!userData.profile) return res.json({ text: "Заполни профиль!" });
    const p = userData.profile;
    const prompt = `Ты тренер. Цель ${p.goal}. Дай ОЧЕНЬ короткий совет (1 фраза).`;
    const text = await askGemini(prompt);
    const finalMsg = text || "Профиль готов! Давай начнем, жду твой первый отчет по еде.";
    userData.logs.push({ role: 'ai', text: finalMsg });
    saveData(userData);
    res.json({ text: finalMsg });
});

app.post('/analyze-chat', async (req, res) => {
    const prompt = `Диетолог. Юзер: ${JSON.stringify(userData.profile)}. Еда: "${req.body.text}". Напиши STATS{"cal":0,"p":0,"f":0,"c":0} и совет.`;
    userData.logs.push({ role: 'user', text: req.body.text });
    const aiResponse = await askGemini(prompt);
    
    if (aiResponse) {
        let statsMatch = aiResponse.match(/STATS({.*?})/);
        if (statsMatch) {
            try {
                const stats = JSON.parse(statsMatch[1]);
                userData.consumedToday.cal += (Number(stats.cal) || 0);
                userData.consumedToday.p += (Number(stats.p) || 0);
                userData.consumedToday.f += (Number(stats.f) || 0);
                userData.consumedToday.c += (Number(stats.c) || 0);
            } catch(e) { console.error("JSON Parse error in stats"); }
        }
        let cleanText = aiResponse.replace(/STATS{.*?}/, "").trim();
        userData.logs.push({ role: 'ai', text: cleanText });
        saveData(userData);
        res.json({ text: cleanText, userData });
    } else {
        const failMsg = "Пока не могу проанализировать, но еду запомнил! (Проблема с API)";
        userData.logs.push({ role: 'ai', text: failMsg });
        saveData(userData);
        res.json({ text: failMsg, userData });
    }
});

app.get('/get-advice', async (req, res) => {
    const prompt = `Короткий бодрый совет для атлета.`;
    const advice = await askGemini(prompt);
    res.json({ advice: advice || "Просто продолжай тренироваться!" });
});

app.get('/get-data', (req, res) => res.json(userData));

app.post('/reset', (req, res) => { 
    userData.consumedToday = { cal: 0, p: 0, f: 0, c: 0 }; 
    userData.logs = []; 
    saveData(userData); 
    res.json(userData); 
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, async () => { ... });
    await findWorkingModel(); 
    console.log(`🚀 COACH AI ACTIVE: http://localhost:${PORT}`); 
});