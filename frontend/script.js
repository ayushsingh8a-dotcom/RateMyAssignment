const themeToggle = document.getElementById("theme-toggle");

const savedTheme = localStorage.getItem("theme");

function getSystemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function applyTheme(theme) {
    document.body.classList.toggle("light-mode", theme === "light");

    themeToggle.textContent = theme === "dark" ? "☀" : "◐";

    document.documentElement.style.colorScheme = theme;
}

const initialTheme = savedTheme || getSystemTheme();

applyTheme(initialTheme);

themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.style.colorScheme;

    const newTheme = currentTheme === "dark"
        ? "light"
        : "dark";

    localStorage.setItem("theme", newTheme);

    applyTheme(newTheme);
});

const instructions = document.getElementById("instructions");
const assignment = document.getElementById("assignment");
const rateButton = document.getElementById("rate-button");

const uploadPage = document.getElementById("upload-page");
const analyzingPage = document.getElementById("analyzing-page");
const resultsPage = document.getElementById("results-page");

const uploadBox = document.getElementById("upload-box");
const fileInfo = document.getElementById("file-info");
const fileName = document.getElementById("file-name");
const fileSize = document.getElementById("file-size");
const removeFile = document.getElementById("remove-file");

const characterCount = document.getElementById("character-count");

const backButton = document.getElementById("back-button");
const againButton = document.getElementById("again-button");

let analysisTimer;

assignment.addEventListener("change", () => {
    if (assignment.files.length) {
        showSelectedFile(assignment.files[0]);
    }
});

function showSelectedFile(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);

    fileInfo.classList.remove("hidden");
    uploadBox.classList.add("hidden");
}

function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

removeFile.addEventListener("click", () => {
    assignment.value = "";
    fileInfo.classList.add("hidden");
    uploadBox.classList.remove("hidden");
});

uploadBox.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadBox.classList.add("dragover");
});

uploadBox.addEventListener("dragleave", () => {
    uploadBox.classList.remove("dragover");
});

uploadBox.addEventListener("drop", (event) => {
    event.preventDefault();

    uploadBox.classList.remove("dragover");

    const file = event.dataTransfer.files[0];

    if (!file) {
        return;
    }

    const allowedTypes = [
        "application/pdf",
        "text/plain",
        "image/jpeg",
        "image/png"
    ];

    if (!allowedTypes.includes(file.type)) {
        alert("Please upload a PDF, JPG, JPEG, PNG, or TXT file.");
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert("File is too large. Maximum size is 10 MB.");
        return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    assignment.files = dataTransfer.files;

    showSelectedFile(file);
});

instructions.addEventListener("input", () => {
    characterCount.textContent = instructions.value.length;
});

rateButton.addEventListener("click", async () => {
    if (!assignment.files.length) {
        alert("Please upload your assignment.");
        return;
    }

    uploadPage.classList.add("hidden");
    analyzingPage.classList.remove("hidden");

    startAnalysisAnimation();

    rateButton.disabled = true;

    const formData = new FormData();

    formData.append("assignment", assignment.files[0]);
    formData.append("instructions", instructions.value);

    try {
const response = await fetch("https://ratemyassignment.onrender.com/rate", {
            method: "POST",
            body: formData
        });

        const result = await response.json();

console.log("1 - JSON received", result);

if (!response.ok) {
    throw new Error(result.error || "Something went wrong.");
}

console.log("2 - Response OK");

clearInterval(analysisTimer);

console.log("3 - Calling showResults");

showResults(result);

console.log("4 - showResults finished");
    } catch (error) {
        clearInterval(analysisTimer);

        analyzingPage.classList.add("hidden");
        uploadPage.classList.remove("hidden");

        alert("Something went wrong: " + error.message);
    }

    rateButton.disabled = false;
});

function startAnalysisAnimation() {
    const status = document.getElementById("analysis-status");

    const steps = [
        {
            text: "Reading your assignment...",
            active: "step-reading"
        },
        {
            text: "Identifying questions and answers...",
            active: "step-questions"
        },
        {
            text: "Checking your answers...",
            active: "step-grading"
        },
        {
            text: "Preparing your results...",
            active: "step-results"
        }
    ];

    let current = 0;

    document.querySelectorAll(".analysis-step").forEach(step => {
        step.classList.remove("active");
    });

    document.getElementById("step-reading").classList.add("active");

    status.textContent = steps[0].text;

    analysisTimer = setInterval(() => {
        current++;

        if (current >= steps.length) {
            clearInterval(analysisTimer);
            return;
        }

        status.textContent = steps[current].text;

        document.querySelectorAll(".analysis-step").forEach(step => {
            step.classList.remove("active");
        });

        document.getElementById(steps[current].active).classList.add("active");

    }, 2200);
}

function showResults(result) {
    uploadPage.classList.add("hidden");
    analyzingPage.classList.add("hidden");
    resultsPage.classList.remove("hidden");

    document.getElementById("score").textContent = result.score;
    document.getElementById("grade").textContent = result.grade;
    document.getElementById("summary").textContent = result.summary;

    setCategory("content", result.categories.content);
    setCategory("clarity", result.categories.clarity);
    setCategory("understanding", result.categories.understanding);
    setCategory("structure", result.categories.structure);
    setCategory("completeness", result.categories.completeness);

    const questionsContainer = document.getElementById("questions");

    questionsContainer.innerHTML = "";

    if (result.questions && result.questions.length) {
        result.questions.forEach((item, index) => {
            const question = document.createElement("div");

            question.className = "question";

            question.innerHTML = `
                <div class="question-top">
                    <span class="question-number">QUESTION ${index + 1}</span>
                    <span class="question-score">${item.score}/20</span>
                </div>

                <div class="question-text">
                    ${escapeHtml(item.question)}
                </div>

                <div class="question-feedback">
                    ${escapeHtml(item.feedback)}
                </div>
            `;

            questionsContainer.appendChild(question);
        });
    } else {
        questionsContainer.innerHTML = "<p>No individual questions were detected.</p>";
    }

    fillList("strengths", result.strengths);
    fillList("weaknesses", result.weaknesses);
    fillList("suggestions", result.suggestions);

    document.getElementById("verdict").textContent = result.verdict;

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function setCategory(name, score) {
    document.getElementById(`${name}-score`).textContent = `${score}/20`;
    document.getElementById(`${name}-bar`).style.width = `${(score / 20) * 100}%`;
}

function fillList(id, items) {
    const list = document.getElementById(id);

    list.innerHTML = "";

    if (!items || !items.length) {
        list.innerHTML = "<li>Nothing specific to report.</li>";
        return;
    }

    items.forEach(item => {
        const li = document.createElement("li");

        li.textContent = item;

        list.appendChild(li);
    });
}

function escapeHtml(text) {
    const div = document.createElement("div");

    div.textContent = text || "";

    return div.innerHTML;
}

function resetPage() {
    resultsPage.classList.add("hidden");
    analyzingPage.classList.add("hidden");
    uploadPage.classList.remove("hidden");

    assignment.value = "";
    instructions.value = "";

    characterCount.textContent = "0";

    fileInfo.classList.add("hidden");
    uploadBox.classList.remove("hidden");

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

backButton.addEventListener("click", resetPage);
againButton.addEventListener("click", resetPage);
