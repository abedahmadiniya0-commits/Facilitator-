/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import fs from "fs";

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "db.json");

// Safe DB Read/Write helper
function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading DB file:", err);
    return [];
  }
}

function writeDb(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing DB file:", err);
  }
}

// REST endpoints for cloud storage sync
app.get("/api/events", (req, res) => {
  res.json(readDb());
});

app.post("/api/events", (req, res) => {
  const data = req.body;
  writeDb(data);
  res.json({ success: true });
});

// Live Score Webhook for real-time mobile dynamics entry
app.post("/api/events/:eventId/teams/:teamId/live-score", (req, res) => {
  const { eventId, teamId } = req.params;
  const { communication, trust, coordination, problemSolving, resilience, memberName } = req.body;

  const events = readDb();
  const event = events.find((e: any) => e.id === eventId);
  if (!event) {
    return res.status(404).json({ error: "رویداد پیدا نشد" });
  }

  const team = event.teams.find((t: any) => t.id === teamId);
  if (!team) {
    return res.status(404).json({ error: "تیم پیدا نشد" });
  }

  // Initialize liveScores list
  team.liveScores = team.liveScores || [];

  const newSubmission = {
    id: `ls_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    communication: Number(communication),
    trust: Number(trust),
    coordination: Number(coordination),
    problemSolving: Number(problemSolving),
    resilience: Number(resilience),
    memberName: memberName || "هم‌تیمی ناشناس",
    timestamp: new Date().toISOString()
  };

  team.liveScores.push(newSubmission);

  // Auto-calculate new average postScores in real time
  const count = team.liveScores.length;
  const sums = team.liveScores.reduce(
    (acc: any, curr: any) => {
      acc.communication += curr.communication;
      acc.trust += curr.trust;
      acc.coordination += curr.coordination;
      acc.problemSolving += curr.problemSolving;
      acc.resilience += curr.resilience;
      return acc;
    },
    { communication: 0, trust: 0, coordination: 0, problemSolving: 0, resilience: 0 }
  );

  team.postScores = {
    communication: Math.round((sums.communication / count) * 10) / 10,
    trust: Math.round((sums.trust / count) * 10) / 10,
    coordination: Math.round((sums.coordination / count) * 10) / 10,
    problemSolving: Math.round((sums.problemSolving / count) * 10) / 10,
    resilience: Math.round((sums.resilience / count) * 10) / 10,
  };

  writeDb(events);
  res.json({ success: true, liveScores: team.liveScores, updatedPostScores: team.postScores });
});

// Initialize Gemini Client
const aiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Resilient Fallback Generator for Debrief Analysis (matching AGENTS.md / comzee rules)
function getFallbackAnalysis(event: any, team: any): any {
  const teamId = team.id;
  const teamName = team.name;

  // Identify positive and negative behavior tags
  const behaviorTags = team.behaviorTags || [];
  const positiveTags = behaviorTags.filter((t: string) => t.endsWith("✓"));
  const negativeTags = behaviorTags.filter((t: string) => t.endsWith("❌"));

  // Find lowest and highest scores
  const scores: any = team.postScores || { communication: 5, trust: 5, coordination: 5, problemSolving: 5, resilience: 5 };
  const sortedScores = Object.entries(scores)
    .map(([key, val]) => ({ key, val: Number(val) }))
    .sort((a, b) => b.val - a.val);
  
  const highestScore = sortedScores[0] || { key: "communication", val: 7 };
  const lowestScore = sortedScores[sortedScores.length - 1] || { key: "trust", val: 5 };

  const scoreLabelsFa: Record<string, string> = {
    communication: "ارتباطات و تسهیم اطلاعات",
    trust: "اعتماد و امنیت روانی",
    coordination: "رهبری و هماهنگی تیمی",
    problemSolving: "حل مسئله و خلاقیت",
    resilience: "تاب‌آوری و مدیریت بحران"
  };

  // 1. Generate Strengths based on highest scores and positive tags
  const strengths = [];
  const strengthName1 = positiveTags[0] ? positiveTags[0].replace("✓", "").trim() : `قدرت در ${scoreLabelsFa[highestScore.key]}`;
  const strengthDesc1 = `تیم توانست در زمینه ${scoreLabelsFa[highestScore.key]} عملکرد بسیار مطلوبی را حین بازی‌های گروهی به نمایش بگذارد. اعضا با هماهنگی بالا هم‌افزایی مناسبی ایجاد کردند.`;
  const strengthEvidence1 = team.postNotes || `در جریان شبیه‌سازی و تمرین گروهی، هم‌راستایی در تصمیمات کلیدی مشهود بود و نمره ${highestScore.val} از ۱۰ ثبت گردید.`;
  strengths.push({ title: strengthName1, description: strengthDesc1, behavioralEvidence: strengthEvidence1 });

  const strengthName2 = positiveTags[1] ? positiveTags[1].replace("✓", "").trim() : (sortedScores[1] ? `هماهنگی و ${scoreLabelsFa[sortedScores[1].key]}` : "حمایت هم‌تیمی‌ها");
  const strengthDesc2 = `بروز روحیه همکاری و تعامل سازنده در لایه‌های رفتاری تیم که منجر به بهبود تصمیم‌گیری و تسریع روند حل چالش‌ها گردید.`;
  const strengthEvidence2 = team.reflection?.whatWentWell || "بازخورد مثبت اعضا نشان‌دهنده ارتقای همدلی و مشارکت سازنده در جریان رویداد است.";
  strengths.push({ title: strengthName2, description: strengthDesc2, behavioralEvidence: strengthEvidence2 });

  // 2. Generate Weaknesses based on lowest scores and negative tags
  const weaknesses = [];
  const weaknessName1 = negativeTags[0] ? negativeTags[0].replace("❌", "").trim() : `محدودیت در ${scoreLabelsFa[lowestScore.key]}`;
  const weaknessDesc1 = `بررسی داده‌های رفتاری نشان می‌دهد تیم در بعد ${scoreLabelsFa[lowestScore.key]} با چالش‌ها و مقاومت‌هایی مواجه بوده که سرعت پیشرفت را کاهش داده است.`;
  const weaknessRoot1 = `ریشه این چالش در ترس از قضاوت، عدم وضوح نقش‌ها در شرایط فشار زمان و تمایل ناخودآگاه به کار انفرادی (تفکر جزیره‌ای) به جای هم‌افزایی تیمی نهفته است.`;
  weaknesses.push({ title: weaknessName1, description: weaknessDesc1, rootCause: weaknessRoot1 });

  const weaknessName2 = negativeTags[1] ? negativeTags[1].replace("❌", "").trim() : (sortedScores[3] ? `ابهام در ${scoreLabelsFa[sortedScores[3].key]}` : "مدیریت بهینه زمان");
  const weaknessDesc2 = `وجود الگوهای ارتباطی یک‌طرفه و عدم بازخورد به موقع در حین تغییر قوانین یا شبیه‌سازها که باعث افت موقت کارایی تیم گردید.`;
  const weaknessRoot2 = `عدم تمرین کانال‌های موازی ارتباطی و متمرکز شدن تصمیم‌گیری‌ها در یک یا دو نفر، باعث خستگی ذهنی و افزایش استرس در شرایط بحرانی می‌شود.`;
  weaknesses.push({ title: weaknessName2, description: weaknessDesc2, rootCause: weaknessRoot2 });

  // 3. Generate Comzee Insights (Office Transfer)
  const comzeeInsights = [
    `شکاف بین اهداف کارگاه و رفتارهای مشاهده‌شده نشان می‌دهد که تیم در شرایط ابهام، تمایل دارد به الگوهای امن قدیمی (کارهای انفرادی) برگردد. برای انتقال موثر یادگیری به محیط کار، لازم است تمرین‌های مستمر امنیت روانی اجرا شود.`,
    `هنگامی که نمره ${scoreLabelsFa.trust} پایین‌تر از حد انتظار است، اعضا در جلسات اداری واقعی نیز از ابراز ایده‌های نوآورانه یا پذیرش ریسک‌های کاری خودداری می‌کنند که این امر خلاقیت سازمانی را کاهش می‌دهد.`,
    `تطبیق رفتارهای بازی جدی با محیط اداری نشان می‌دهد تقویت کانال‌های ارتباطی شفاف، زمان جلسات روزانه همگام‌سازی را تا ۳۰ درصد کاهش و بهره‌وری را افزایش می‌دهد.`
  ];

  // 4. Generate Workspace Transfer (Micro-practices)
  const workspaceTransfer = [
    {
      actionableStep: "برگزاری روزانه استندآپ ۳ دقیقه‌ای شفافیت نقش‌ها",
      officeApplication: "در شروع هر روز کاری، هر عضو تیم تنها در ۳۰ ثانیه می‌گوید: ۱. اولویت اصلی امروز من چیست؟ ۲. به چه کمکی از دیگران نیاز دارم؟ این تمرین مستقیماً هماهنگی و وضوح نقش‌ها را تقویت می‌کند."
    },
    {
      actionableStep: "تکنیک 'مخالفت سازنده بدون قضاوت' در جلسات هفتگی",
      officeApplication: "در جلسات تصمیم‌گیری، یک نفر به عنوان 'مدافع شیطان' نقش به چالش کشیدن تمام فرضیات را بر عهده می‌گیرد تا امنیت روانی برای ابراز نظرات مخالف تضمین شود و تفکر جزیره‌ای کاهش یابد."
    }
  ];

  // 5. Generate Presentation Slides
  const slides = [
    {
      id: 1,
      title: `نتایج تحلیل پویایی و دیبریف تیمی: ${teamName}`,
      subtitle: "رویکرد اختصاصی کامزی مبتنی بر شبیه‌سازی‌های رفتاری",
      type: "title" as const,
      content: [
        `تحلیل جامع پویایی‌های تیمی رویداد برای سازمان ${event.clientName || "محترم"}`,
        `تسهیل‌گر رویداد: ${event.facilitatorName || "ثبت نشده"}`,
        "تمرکز بر ایجاد پل میان بازی‌های جدی تجربی و رفتارهای واقعی در دفتر کار"
      ]
    },
    {
      id: 2,
      title: "نمودار تحلیل پویایی‌های ۵گانه تیمی",
      subtitle: `مقایسه شاخص‌های رفتاری بر اساس ارزیابی‌های مستقیم (از ۱۰ نمره)`,
      type: "chart" as const,
      content: [
        `بالاترین شاخص ثبت‌شده: **${scoreLabelsFa[highestScore.key]}** با نمره **${highestScore.val}**`,
        `شاخص نیازمند بهبود: **${scoreLabelsFa[lowestScore.key]}** با نمره **${lowestScore.val}**`,
        "نمرات پسا-رویداد نشان‌دهنده پتانسیل بالای ارتقای کار تیمی در محیط کار اداری است."
      ]
    },
    {
      id: 3,
      title: "توتالیت رشد و نقاط قوت تیمی",
      subtitle: "بروز رفتارهای اثربخش تایید شده در طول شبیه‌سازها",
      type: "strengths" as const,
      content: [
        `**${strengthName1}**: ${strengthDesc1}`,
        `**${strengthName2}**: ${strengthDesc2}`,
        `**شواهد عینی تسهیل‌گر**: ${strengthEvidence1.slice(0, 100)}...`
      ]
    },
    {
      id: 4,
      title: "چالش‌های تیمی و ریشه‌یابی رفتاری",
      subtitle: "اصطکاک‌های مانع کارایی و تحلیل ریشه‌ای آن‌ها",
      type: "weaknesses" as const,
      content: [
        `**چالش اول: ${weaknessName1}** - ${weaknessDesc1}`,
        `**ریشه روانی-تیمی**: ${weaknessRoot1}`,
        `**چالش دوم: ${weaknessName2}** - ${weaknessDesc2}`,
        `**ریشه روانی-تیمی**: ${weaknessRoot2}`
      ]
    },
    {
      id: 5,
      title: "انتقال به محیط کار (Workspace Transfer)",
      subtitle: "تمرین‌های ۳ دقیقه‌ای مایکرو-پرکتیس برای جلسات اداری",
      type: "workspace" as const,
      content: [
        `**مایکرو-پرکتیس اول**: ${workspaceTransfer[0].actionableStep}`,
        `**نحوه اجرا در سازمان**: ${workspaceTransfer[0].officeApplication}`,
        `**مایکرو-پرکتیس دوم**: ${workspaceTransfer[1].actionableStep}`,
        `**نحوه اجرا در سازمان**: ${workspaceTransfer[1].officeApplication}`
      ]
    },
    {
      id: 6,
      title: "جمع‌بندی و عهد تیمی کامزی",
      subtitle: "قدم‌های کوچک، تغییرات بزرگ مستمر",
      type: "closing" as const,
      content: [
        "پذیرش متقابل چالش‌ها و تلاش تیمی برای بهبود تدریجی شاخص‌ها",
        "تعهد به اجرای حداقل یک مایکرو-پرکتیس ۳ دقیقه‌ای روزانه به مدت ۲۱ روز متوالی",
        "«تیم‌های عالی ساخته می‌شوند، متولد نمی‌شوند.» سپاس از مشارکت فعال شما!"
      ]
    }
  ];

  return {
    teamId,
    teamName,
    strengths,
    weaknesses,
    comzeeInsights,
    workspaceTransfer,
    slides
  };
}

// Resilient Fallback Generator for custom debrief questions
function getFallbackQuestions(event: any, team: any): any {
  const scores: any = team.postScores || { communication: 5, trust: 5, coordination: 5, problemSolving: 5, resilience: 5 };
  const sortedScores = Object.entries(scores)
    .map(([key, val]) => ({ key, val: Number(val) }))
    .sort((a, b) => a.val - b.val);
  
  const lowestScore = sortedScores[0] || { key: "trust", val: 5 };
  
  const scoreLabelsFa: Record<string, string> = {
    communication: "ارتباطات و تسهیم اطلاعات",
    trust: "اعتماد و امنیت روانی",
    coordination: "رهبری و هماهنگی تیمی",
    problemSolving: "حل مسئله و خلاقیت",
    resilience: "تاب‌آوری و مدیریت بحران"
  };

  const behaviorTags = team.behaviorTags || [];
  const negativeTags = behaviorTags.filter((t: string) => t.endsWith("❌"));
  const primaryWeakness = negativeTags[0] ? negativeTags[0].replace("❌", "").trim() : scoreLabelsFa[lowestScore.key];

  return {
    questions: [
      {
        id: 1,
        question: `در طول کارگاه دیدیم که با تغییر غیرمنتظره شرایط بازی، نحوه تعامل اعضا تغییر کرد. به نظر شما در شرایط فشار کار واقعی در سازمان، چقدر این ابهام روی کیفیت ارتباطات ما تاثیر منفی می‌گذارد و چطور می‌توانیم اثرش را کم کنیم؟`,
        intent: "برانگیختن گوش دادن فعال و بازکردن کانال ارتباطی صمیمانه",
        oridCategory: "بازتابی (Reflective)"
      },
      {
        id: 2,
        question: `نمره بعد "${scoreLabelsFa[lowestScore.key]}" تیم ما ${lowestScore.val} از ۱۰ ثبت شده است. چه رفتارها یا الگوهای تکرارشونده‌ای در محیط کار باعث بروز رفتارهایی نظیر "${primaryWeakness}" می‌شود؟`,
        intent: "شناسایی ریشه سیلوهای اطلاعاتی و هدایت به خودآگاهی سازنده",
        oridCategory: "تفسیری (Interpretive)"
      },
      {
        id: 3,
        question: `با توجه به یادگیری‌های امروز، چه تعهد ملموس و کوچکی را می‌توانیم به عنوان یک 'مایکرو-پرکتیس روزانه' در جلسات استندآپ خود اضافه کنیم تا مطمئن شویم این دستاوردها ماندگار می‌مانند؟`,
        intent: "ترغیب به تصمیم‌گیری عملیاتی و مسئولیت‌پذیری در اجرای تغییرات",
        oridCategory: "تصمیم‌گیری (Decisive)"
      }
    ]
  };
}

// Resilient Fallback Generator for assistant projector
function getFallbackProjectorText(context: string, observations: string, analysis: string): string {
  return `📌 [دیبریف پروژکتور: ${context || "شبیه‌ساز کار تیمی"}]
---
### 🔍 مشاهدات کلیدی:
* **چالش اصلی تیم:** عدم وضوح نقش‌ها در ابهام (شواهد: ${observations || "رفتار ناهمگام"})
* **رفتار گروهی شاخص:** هم‌افزایی پس از تسهیل‌گری
---
### 💡 درس‌آموخته‌های سازمانی:
* **نقطه قوت:** گوش دادن فعال در لحظات بحران
* **توصیه اجرایی:** برگزاری مایکرو-پرکتیس ۳ دقیقه‌ای روزانه
---
### 🚀 گام‌های بعدی تیم:
* تعهد به شفافیت نقش‌ها در جلسات واقعی`;
}

// Tone Guidelines for Comzee AI
const TONE_GUIDELINES: Record<string, string> = {
  motivational: `
    - لحن خروجی باید کاملاً الهام‌بخش، مثبت‌نگر، انگیزشی و بسیار پرانرژی باشد.
    - روی فرصت‌های رشد بی‌نظیر تیمی، ظرفیت‌های پنهان کشف‌شده و نقاط قوت تمرکز کن.
    - بازخوردها، تحلیل‌ها و مایکروپرکتیس‌ها را به گونه‌ای طراحی کن که اعضا پس از خواندن آن احساس همدلی عمیق، شور و انگیزه بسیار بالایی برای ارتقای تیم داشته باشند و تشویق شوند.
    - از کلمات پرانرژی، امیدبخش و الهام‌آفرین استفاده کن.
  `,
  analytical: `
    - لحن خروجی باید کاملاً دقیق، علمی، ساختاریافته، جدی، منطقی و مبتنی بر شواهد عینی باشد.
    - از کلی‌گویی یا توصیف‌های احساسی بی‌مورد خودداری کن.
    - با رویکرد پویایی تیمی عمیق و تحلیل‌های روانشناسی سازمانی ملموس، به ارزیابی موشکافانه رفتارها بپرداز.
    - توصیه‌ها و مایکروپرکتیس‌ها را با استدلال‌های منطقی و علمی توجیه کن.
  `,
  strict: `
    - لحن خروجی باید کاملاً صریح، نقادانه، مطالبه‌گر، رک و بسیار جدی باشد.
    - بدون هرگونه تعارف یا پرده‌پوشی، نقاط ضعف، سستی‌ها، موازی‌کاری‌ها یا ناهماهنگی‌های حین رویداد را به چالش بکش.
    - به تیم یادآوری کن که برای ساختن یک تیم عالی، باید با واقعیت‌های سخت روبرو شد و مسئولیت‌پذیری صددرصدی داشت.
    - با جدیت بالا و لحنی قاطع و مطالبه‌گر، به نقد تعارضات تیمی بپرداز تا اعضا ضرورتِ مطلق تغییر رفتارهای آسیب‌زا را حس کنند.
  `
};

// AI Analyze Endpoint for Team Debrief
app.post("/api/debrief/analyze", async (req, res) => {
  try {
    const { event, team } = req.body;

    if (!event || !team) {
      return res.status(400).json({ error: "اطلاعات رویداد و تیم الزامی است." });
    }

    const tone = event?.aiTone || "analytical";

    const prompt = `
      به عنوان تسهیلگر ارشد سازمانی و متخصص پویایی‌شناسی تیم (Team Dynamics)، وظیفه تو تحلیل داده‌های مشاهده‌گر (Observer) و تبدیل آن‌ها به بازخورد (Debrief) عمیق، عملیاتی و همدلانه است.

      --- لحن خروجی گزارش (Output Tone) ---
      لحن تنظیم‌شده توسط تسهیل‌گر: ${tone === "motivational" ? "انگیزشی و الهام‌بخش" : tone === "strict" ? "سخت‌گیرانه و مطالبه‌گر" : "تحلیل‌گرایانه و علمی"}
      دستورالعمل لحن گزارش:
      ${TONE_GUIDELINES[tone] || TONE_GUIDELINES.analytical}

      --- داده‌های ورودی (Input Data) ---
      اهداف اصلی کارگاه (Event Goals):
      ${event.goals.join("، ")}

      ماهیت بازی و تمرینات انجام شده (Games Played):
      ${event.gamesPlayed && event.gamesPlayed.length > 0 
        ? event.gamesPlayed.map((g: any) => `- **${g.name}**: ${g.description} (تمرکز بر: ${g.focus})`).join("\n")
        : "ثبت نشده"}

      رفتارهایی که در چک‌لیست ۳۰ موردی تیک خورده‌اند (Observed Cues / Checklist):
      ${team.behaviorTags && team.behaviorTags.length > 0 
        ? team.behaviorTags.join("، ") 
        : "رفتار خاصی ثبت نشده است"}

      یادداشت‌های کیفی تسهیل‌گر (Facilitator Notes):
      ${team.postNotes || "ندارد"}

      --- امتیازات عددی پویایی‌های تیمی (از ۱۰) ---
      ارتباطات: ${team.postScores.communication}
      امنیت روانی و اعتماد: ${team.postScores.trust}
      هماهنگی و رهبری: ${team.postScores.coordination}
      حل مسئله: ${team.postScores.problemSolving}
      تاب‌آوری: ${team.postScores.resilience}

      --- خودارزیابی اعضای تیم (Team Reflections) ---
      نقاط قوت خودارزیابی: ${team.reflection.whatWentWell || "ثبت نشده"}
      چالش‌ها از دید اعضا: ${team.reflection.challenges || "ثبت نشده"}
      درس‌آموخته‌های اعضا: ${team.reflection.learnings || "ثبت نشده"}
      برنامه اقدام اولیه اعضا: ${team.reflection.actionPlan || "ثبت نشده"}

      --- گام‌های تحلیل و منطق ارزیابی (Logic & Analysis Steps) ---
      ۱. شناسایی شکاف (Identify the Gap): اختلاف میان "اهداف کارگاه" و "رفتارهای مشاهده‌شده" را به دقت شناسایی و تحلیل کن.
      ۲. نسبت‌دهی رفتاری (Behavioral Attribution): رفتارهای منفی یا چالش‌برانگیز مشاهده‌شده را به لایه‌های رفتاری مربوطه (ارتباطات، امنیت روانی، استراتژی، هماهنگی، تاب‌آوری، رهبری) نسبت داده و ریشه‌یابی عمیق کن.
      ۳. تدوین بینش‌های عمیق (Draft Insights): برای هر رفتار منفی، یک "Insight" یا بینش عمیق بنویس که تیم بفهمد چرا آن رفتار در محیط کار واقعی (Office Transfer / سازمان) آسیب‌زا است.
      ۴. طراحی برنامه اقدام عملیاتی (Actionable Plan): برای هر چالش تیمی، یک تمرین عملیاتی ۳ دقیقه‌ای (Micro-practice) طراحی کن که تیم بتواند در جلسات کاریِ روزانه خود (مثلاً استندآپ یا جلسات همگام‌سازی) پیاده کند.

      --- ساختار خروجی و اسلایدها ---
      بر اساس این تحلیل عمیق، خروجی JSON زیر را تولید کن. همچنین ۵ تا ۷ اسلاید ارائه تعاملی برای این دیبریف بساز تا تسهیلگر بتواند آن را مستقیماً روی ویدئو پروژکتور برای تیم ارائه دهد.
      نوع اسلایدها (slide type) باید از موارد زیر باشد:
      - "title": اسلاید عنوان و مقدمه
      - "chart": اسلایدی برای نمایش و تحلیل نمودار پویایی‌های تیمی
      - "strengths": تحلیل نقاط قوت بر اساس شواهد رفتاری واقعی رویداد
      - "weaknesses": ریشه‌یابی چالش‌ها و نقاط قابل بهبود با نسبت‌دهی رفتاری دقیق
      - "recommendations": پیشنهادات توسعه فردی و تیمی اختصاصی کامزی
      - "workspace": برنامه اقدام (Action Plan) برای انتقال یادگیری به محیط اداری واقعی (Micro-practice)
      - "closing": اسلاید جمع‌بندی و عهد تیمی
    `;

    let data;
    try {
      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `
            تو یک تسهیلگر ارشد سازمانی، متخصص توسعه پویایی‌های تیمی (Team Dynamics) و مشاور ارشد کامزی (comzee.ir) هستی.
            وظیفه تو تحلیل داده‌های مشاهده‌گر و تبدیل آن‌ها به بازخورد (Debrief) عمیق، عملیاتی، همدلانه و متمرکز بر رشد است.

            دستورالعمل‌های سبک و لحن (Style Guidelines):
            ${TONE_GUIDELINES[tone] || TONE_GUIDELINES.analytical}
            - از کلی‌گویی به شدت پرهیز کن و دقیقاً به همان رفتارهای تیک‌خورده در چک‌لیست و یادداشت‌های تسهیلگر استناد کن.
            - تحلیل‌ها و راه‌حل‌ها را بسیار ملموس و قابل اجرا در کار روزمره سازمان طراحی کن.
            
            تمام خروجی‌ها را با رعایت دقیق ساختار JSON زیر به زبان فارسی تولید کن.
          `,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              teamId: { type: Type.STRING, description: "The ID of the analyzed team" },
              teamName: { type: Type.STRING, description: "The name of the analyzed team" },
              strengths: {
                type: Type.ARRAY,
                description: "لیست نقاط قوت کلیدی تیم بر اساس رفتارهای واقعی رویداد",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "عنوان نقطه قوت" },
                    description: { type: Type.STRING, description: "توضیح کامل نحوه بروز این قوت" },
                    behavioralEvidence: { type: Type.STRING, description: "شواهد رفتاری واقعی مشاهده شده در طول تمرین" }
                  },
                  required: ["title", "description", "behavioralEvidence"]
                }
              },
              weaknesses: {
                type: Type.ARRAY,
                description: "لیست نقاط ضعف و چالش‌ها همراه با ریشه‌یابی عمیق بر اساس رفتارهای تیک‌خورده",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: "عنوان چالش تیمی" },
                    description: { type: Type.STRING, description: "توضیح چالش و لایه رفتاری مرتبط با آن" },
                    rootCause: { type: Type.STRING, description: "ریشه‌یابی ریشه بروز این چالش از منظر روانشناسی و پویایی تیمی" }
                  },
                  required: ["title", "description", "rootCause"]
                }
              },
              comzeeInsights: {
                type: Type.ARRAY,
                description: "بینش‌های عمیق (Insights) برای فهم آسیب‌زا بودن رفتارهای منفی در محیط واقعی کار (Office Transfer)",
                items: { type: Type.STRING }
              },
              workspaceTransfer: {
                type: Type.ARRAY,
                description: "برنامه اقدام عملیاتی و تمرین‌های ۳ دقیقه‌ای (Micro-practice) برای جلسات روزانه سازمان",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    actionableStep: { type: Type.STRING, description: "تمرین ۳ دقیقه‌ای مشخص (مثلاً: ۳ دقیقه بازخورد سازنده روزانه)" },
                    officeApplication: { type: Type.STRING, description: "نحوه اجرا و کاربرد دقیق آن در محیط کار دفتری" }
                  },
                  required: ["actionableStep", "officeApplication"]
                }
              },
              slides: {
                type: Type.ARRAY,
                description: "۵ تا ۷ اسلاید تعاملی دیبریف برای ارائه روی پروژکتور",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER, description: "Slide sequence number (starting from 1)" },
                    title: { type: Type.STRING, description: "عنوان اسلاید" },
                    subtitle: { type: Type.STRING, description: "زیرعنوان یا توضیح کوتاه اسلاید" },
                    type: { type: Type.STRING, description: "یکی از: title, chart, strengths, weaknesses, recommendations, workspace, closing" },
                    content: {
                      type: Type.ARRAY,
                      description: "گزاره‌های کلیدی اسلاید به صورت بندها یا بالت‌های کوتاه متنی",
                      items: { type: Type.STRING }
                    },
                    visualHint: { type: Type.STRING, description: "آیکون یا افکت پیشنهادی" }
                  },
                  required: ["id", "title", "type", "content"]
                }
              }
            },
            required: ["teamId", "teamName", "strengths", "weaknesses", "comzeeInsights", "workspaceTransfer", "slides"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("نتیجه تحلیل دریافت نشد.");
      }
      data = JSON.parse(resultText);
    } catch (genError: any) {
      console.warn("Gemini API call failed, using high-quality local fallback analysis:", genError.message || genError);
      data = getFallbackAnalysis(event, team);
    }

    res.json(data);
  } catch (error: any) {
    console.error("Error analyzing route:", error);
    res.status(500).json({ error: error.message || "خطا در تحلیل پویایی تیمی" });
  }
});

// AI Questions Endpoint for Team Debrief
app.post("/api/debrief/questions", async (req, res) => {
  try {
    const { event, team } = req.body;

    if (!event || !team) {
      return res.status(400).json({ error: "اطلاعات رویداد و تیم الزامی است." });
    }

    const tone = event?.aiTone || "analytical";

    const prompt = `
      به عنوان تسهیلگر ارشد سازمانی و متخصص پویایی‌شناسی تیم (Team Dynamics)، وظیفه تو طراحی ۳ سوال عمیق و تامل‌برانگیز برای بخش دیبریف (Debrief) کارگاه جدی بر اساس داده‌های رویداد زیر است:

      --- لحن خروجی سوالات (Output Tone) ---
      تنظیم لحن: ${tone === "motivational" ? "انگیزشی و الهام‌بخش" : tone === "strict" ? "سخت‌گیرانه و مطالبه‌گر" : "تحلیل‌گرایانه و علمی"}
      دستورالعمل لحن برای طراحی سوالات:
      ${TONE_GUIDELINES[tone] || TONE_GUIDELINES.analytical}

      --- داده‌های کارگاه ---
      عنوان رویداد: ${event.title}
      سازمان مشتری: ${event.clientName}
      اهداف رویداد: ${event.goals.join("، ")}
      بازی‌های انجام شده:
      ${event.gamesPlayed && event.gamesPlayed.length > 0 
        ? event.gamesPlayed.map((g: any) => `- **${g.name}**: ${g.description}`).join("\n")
        : "ثبت نشده"}

      --- وضعیت و رفتارهای تیم (${team.name}) ---
      امتیازات عددی پویایی‌های تیمی:
      ارتباطات: ${team.postScores.communication}
      اعتماد و امنیت روانی: ${team.postScores.trust}
      هماهنگی و رهبری: ${team.postScores.coordination}
      حل مسئله: ${team.postScores.problemSolving}
      تاب‌آوری: ${team.postScores.resilience}

      رفتارهای تیک خورده در چک‌لیست:
      ${team.behaviorTags && team.behaviorTags.length > 0 ? team.behaviorTags.join("، ") : "رفتار خاصی ثبت نشده است"}

      یادداشت‌های کیفی و مشاهدات تسهیل‌گر: ${team.postNotes || "ثبت نشده"}

      --- خودارزیابی و چالش‌های بیان شده توسط اعضا ---
      چه چیزهایی خوب پیش رفت: ${team.reflection.whatWentWell || "ثبت نشده"}
      چه چالش‌هایی داشتند: ${team.reflection.challenges || "ثبت نشده"}
      درس‌هایی که گرفتند: ${team.reflection.learnings || "ثبت نشده"}
      برنامه انتقال به سازمان: ${team.reflection.actionPlan || "ثبت نشده"}

      از چارچوب دیبریف ORID الهام بگیر. به زبان فارسی شیک، وزین، تسهیل‌گرانه و صمیمی بنویس. برای هر سوال، هدفی که تسهیل‌گر با پرسیدن آن دنبال می‌کند (Intent) و همچنین دسته‌بندی آن در چرخه ORID را مشخص کن.
    `;

    let data;
    try {
      const response = await aiClient.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: `
            تو یک تسهیل‌گر پیشرو و کوچ تیمی با تجربه هستی که برای کامزی (comzee.ir) کار می‌کنی.
            وظیفه تو تولید ۳ سوال عمیق و غیرکلیشه‌ای برای به چالش کشیدن سازنده تیم است.
            
            دستورالعمل لحن برای طراحی سوالات:
            ${TONE_GUIDELINES[tone] || TONE_GUIDELINES.analytical}
            
            از گفتن جملات تکراری مثل 'چطور حس می‌کنید؟' بپرهیز و سوالات را کاملاً بر اساس مغایرت‌ها و داده‌های واقعی بالا بساز.
            ساختار خروجی باید یک شیء JSON حاوی آرایه‌ای از سوالات باشد.
          `,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                description: "۳ سوال کلیدی و عمیق طراحی شده برای دیبریف تیمی",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER, description: "شناسه سوال (۱، ۲، ۳)" },
                    question: { type: Type.STRING, description: "متن سوال تسهیل‌گری عمیق و تامل‌برانگیز" },
                    intent: { type: Type.STRING, description: "علت پرسیدن این سوال و تاثیری که روی تیم می‌گذارد" },
                    oridCategory: { type: Type.STRING, description: "یکی از دسته‌بندی‌های: عینی (Objective)، بازتابی (Reflective)، تفسیری (Interpretive)، تصمیم‌گیری (Decisive)" }
                  },
                  required: ["id", "question", "intent", "oridCategory"]
                }
              }
            },
            required: ["questions"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("سوالی دریافت نشد.");
      }
      data = JSON.parse(resultText);
    } catch (genError: any) {
      console.warn("Gemini API call failed, using high-quality local fallback questions:", genError.message || genError);
      data = getFallbackQuestions(event, team);
    }

    res.json(data);
  } catch (error: any) {
    console.error("Error generating questions route:", error);
    res.status(500).json({ error: error.message || "خطا در تولید سوالات هوشمند" });
  }
});

// AI Assistant Projector generator endpoint
app.post("/api/debrief/assistant-projector", async (req, res) => {
  try {
    const { context, observations, analysis } = req.body;

    const prompt = `
      به عنوان "دستیار هوشمند دیبریف کامزی" (Comzee Debrief Assistant)، وظیفه داری خروجی دیبریف بازی جدی زیر را منحصراً برای نمایش روی پرده پروژکتور فرمت‌دهی کنی.

      --- مشخصات ورودی کارگاه ---
      نام بازی و هدف دیبریف: ${context || "ثبت نشده"}
      مشاهدات کلیدی تسهیل‌گر: ${observations || "ثبت نشده"}
      تحلیل عمیق دیبریف (ORID): ${analysis || "ثبت نشده"}

      --- قوانین خروجی پروژکتور (حیاتی) ---
      ۱. از متون طولانی و پاراگراف‌های چسبیده به هم به شدت خودداری کن.
      ۲. برای ایجاد فضای منفی (Negative Space) و خوانایی عالی روی پرده از دور، بین بخش‌های اصلی حتماً از خطوط جداکننده ضخیم (---) استفاده کن.
      ۳. تمام جملات باید به صورت گزاره‌های کلیدی، کوتاه و تلگرافی (حداکثر ۵ تا ۷ کلمه در هر بالت‌پوینت) باشند.
      ۴. کلمات کلیدی و سرفصل‌ها را حتماً بولد (**Bold**) کن تا از فاصله دور قابل خواندن باشند.
      ۵. خروجی باید به زبان فارسی فاخر، شیک، مینیمال و لوکس باشد.
      ۶. ساختار نهایی خروجی باید شبیه نمونه زیر باشد:

      📌 [نام سناریو / بازی]
      ---
      ### 🔍 مشاهدات کلیدی:
      * **چالش اصلی تیم:** [خلاصه در ۵ کلمه]
      * **رفتار گروهی شاخص:** [خلاصه در ۵ کلمه]
      ---
      ### 💡 درس‌آموخته‌های سازمانی:
      * **نقطه قوت:** [کلیدواژه خلاصه]
      * **توصیه اجرایی:** [کلیدواژه خلاصه]
    `;

    const response = await aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `
          تو دستیار هوشمند دیبریف کامزی هستی. وظیفه داری خروجی دیبریف را منحصراً برای پروژکتور فرمت‌دهی کنی.
          از پرگویی خودداری کن. اصول گزاره‌های تلگرافی (۵ تا ۷ کلمه) و فضاهای خالی را دقیقاً رعایت کن.
        `,
      }
    });

    const resultText = response.text;
    res.json({ result: resultText });
  } catch (error: any) {
    console.error("Error in assistant projector generator:", error);
    res.status(500).json({ error: error.message || "خطا در تولید خروجی پروژکتور" });
  }
});

// Setup Vite Dev server or static asset serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

setupServer().catch((err) => {
  console.error("Failed to start server:", err);
});
