const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

app.use(express.json());
app.use(express.static(__dirname));

// АДАПТАЦИЯ ПОД RENDER
const PORT = process.env.PORT || 3000;
const DATA_FILE = '/tmp/user_data.json'; 
const API_KEY = process.env.GEMINI_KEY; // Берем из настроек Render (Environment Variables)

const DAILY_CALORIE_LIMIT = 2100;
let currentModel = ""; 

// 1. Поиск живой модели (Gemini 2.5 / 2.0)
async function findWorkingModel() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (data.models) {
            // Ищем самую новую модель, которая поддерживает генерацию
            const found = data.models.find(m => m.supportedGenerationMethods.includes("generateContent"));
            if (found) {
                currentModel = found.name;
                console.log(`✅ Найдена рабочая модель: ${currentModel}`);
                return true;
            }
        }
        return false;
    } catch (e) { 
        console.error("Ошибка при поиске модели:", e);
        return false; 
    }
}

const loadData = () => {
    if (fs.existsSync(DATA_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DATA_FILE));
        } catch (e) { return { consumedToday: 0, burnedToday: 0, logs: [] }; }
    }
    return { consumedToday: 0, burnedToday: 0, logs: [] };
};

const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

let userData = loadData();

// Универсальная функция запроса к ИИ
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
        
        if (data.error) {
            console.error("Gemini Error:", data.error.message);
            return null;
        }
        
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("Ошибка запроса к ИИ:", e);
        return null;
    }
}

// МАРШРУТ: Анализ еды
app.post('/analyze-food', async (req, res) => {
    const prompt = `Ты диетолог. Устенко съел: "${req.body.text}". Дай ТОЛЬКО JSON: {"calories": число, "comment": "фраза до 10 слов"}`;
    const aiResponse = await askGemini(prompt);
    
    if (aiResponse) {
        try {
            let cleanJson = aiResponse.replace(/```json|```/gi, "").trim();
            const aiResult = JSON.parse(cleanJson);
            
            userData.consumedToday += aiResult.calories;
            userData.logs.push({ 
                time: new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}), 
                text: req.body.text, 
                cal: aiResult.calories, 
                type: 'food' 
            });
            saveData(userData);
            res.json({ 
                message: aiResult.comment, 
                remaining: (DAILY_CALORIE_LIMIT + userData.burnedToday) - userData.consumedToday, 
                logs: userData.logs 
            });
        } catch (e) {
            res.status(500).json({ message: "Ошибка обработки данных ИИ" });
        }
    } else {
        res.status(500).json({ message: "ИИ не ответил" });
    }
});

// МАРШРУТ: Совет тренера
app.get('/get-advice', async (req, res) => {
    const history = userData.logs.length > 0 ? userData.logs.map(l => l.text).join(", ") : "ничего не ел";
    const prompt = `Проанализируй день Устенко. Он съел: ${history}. Сжег: ${userData.burnedToday}. Дай ОДИН очень короткий и дерзкий совет как тренер (максимум 15 слов).`;
    
    const advice = await askGemini(prompt);
    res.json({ advice: advice || "Устенко, просто продолжай фигачить!" });
});

app.get('/get-data', (req, res) => {
    res.json({ 
        remaining: (DAILY_CALORIE_LIMIT + userData.burnedToday) - userData.consumedToday, 
        logs: userData.logs,
        burned: userData.burnedToday 
    });
});

app.post('/training', (req, res) => {
    userData.burnedToday += 350;
    userData.logs.push({ 
        time: new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}), 
        text: "Тренировка 💪", 
        cal: -350, 
        type: 'train' 
    });
    saveData(userData);
    res.json({ 
        message: "Мощно, Устенко!", 
        remaining: (DAILY_CALORIE_LIMIT + userData.burnedToday) - userData.consumedToday, 
        logs: userData.logs 
    });
});

app.post('/reset', (req, res) => { 
    userData = { consumedToday: 0, burnedToday: 0, logs: [] }; 
    saveData(userData); 
    res.json({ remaining: DAILY_CALORIE_LIMIT, logs: [] }); 
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, async () => {
    await findWorkingModel();
    console.log(`\n🚀 COACH AI: ЗАПУЩЕН НА ПОРТУ ${PORT}`);
});
