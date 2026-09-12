const helmet = require("helmet");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const app = express();
const PORT = 3000;
app.use(helmet());

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const allowedMimeTypes = new Set([
    "application/pdf",
    "text/plain",
    "image/jpeg",
    "image/png"
]);

async function validateFileSignature(file) {
    if (file.mimetype === "text/plain") {
        return true;
    }

    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(file.buffer);

    if (!detected) {
        return false;
    }

    return detected.mime === file.mimetype;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            return cb(new Error("Only PDF, JPG, PNG, and TXT files are allowed."));
        }

        cb(null, true);
    }
});

const gradingLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many grading requests. Please try again in a few minutes."
    }
});

app.use(cors());
app.use(express.json({
    limit: "100kb"
}));

app.post(
    "/rate",
    gradingLimiter,
    (req, res, next) => {
        upload.single("assignment")(req, res, (error) => {
            if (error) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({
                        error: "File is too large. Maximum size is 10 MB."
                    });
                }

                if (error.code === "LIMIT_FILE_COUNT") {
                    return res.status(400).json({
                        error: "Only one assignment can be uploaded at a time."
                    });
                }

                return res.status(400).json({
                    error: error.message || "Invalid file upload."
                });
            }

            next();
        });
    },
    async (req, res) => {
        const instructions = (req.body.instructions || "").trim();
        const file = req.file;

        if (!file) {
            return res.status(400).json({
                error: "Please upload an assignment."
            });
        }

        if (!allowedMimeTypes.has(file.mimetype)) {
            return res.status(400).json({
                error: "Unsupported file type."
            });
        }

        const validSignature = await validateFileSignature(file);

if (!validSignature) {
    return res.status(400).json({
        error: "The file contents do not match the selected file type."
    });
}

        if (instructions.length > 2000) {
            return res.status(400).json({
                error: "Additional instructions must be 2000 characters or less."
            });
        }

        try {
            const prompt = `
You are a strict but fair college professor grading a student's assignment.

The uploaded file contains the student's complete assignment.

Read the entire assignment and identify the questions and their corresponding answers yourself.

Evaluate every question and answer based on:
- Correctness
- Understanding
- Clarity
- Completeness
- Structure
- Quality of diagrams or working where relevant

If an answer is missing, mention that and consider it when grading.

If the assignment does not have clearly numbered questions, identify the separate questions or tasks yourself.

Additional instructions from the student:
${instructions || "None"}

Return the evaluation as structured JSON.

The overall score must be out of 100.
Each category score must be out of 20.
Each individual question score must be out of 20.
Be honest, specific, and academically reasonable.
`;

            const contents = [
                {
                    text: prompt
                },
                {
                    inlineData: {
                        mimeType: file.mimetype,
                        data: file.buffer.toString("base64")
                    }
                }
            ];

            const response = await Promise.race([
                ai.models.generateContent({
                    model: "gemini-3.6-flash",
                    contents,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "object",
                            properties: {
                                score: {
                                    type: "integer"
                                },
                                grade: {
                                    type: "string"
                                },
                                summary: {
                                    type: "string"
                                },
                                categories: {
                                    type: "object",
                                    properties: {
                                        content: {
                                            type: "integer"
                                        },
                                        clarity: {
                                            type: "integer"
                                        },
                                        understanding: {
                                            type: "integer"
                                        },
                                        structure: {
                                            type: "integer"
                                        },
                                        completeness: {
                                            type: "integer"
                                        }
                                    },
                                    required: [
                                        "content",
                                        "clarity",
                                        "understanding",
                                        "structure",
                                        "completeness"
                                    ]
                                },
                                questions: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            question: {
                                                type: "string"
                                            },
                                            score: {
                                                type: "integer"
                                            },
                                            feedback: {
                                                type: "string"
                                            }
                                        },
                                        required: [
                                            "question",
                                            "score",
                                            "feedback"
                                        ]
                                    }
                                },
                                strengths: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    }
                                },
                                weaknesses: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    }
                                },
                                suggestions: {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    }
                                },
                                verdict: {
                                    type: "string"
                                }
                            },
                            required: [
                                "score",
                                "grade",
                                "summary",
                                "categories",
                                "questions",
                                "strengths",
                                "weaknesses",
                                "suggestions",
                                "verdict"
                            ]
                        }
                    }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => {
                        reject(new Error("AI request timed out. Please try again."))
                    }, 120000)
                )
            ]);

            const result = JSON.parse(response.text);

            if (
                typeof result.score !== "number" ||
                typeof result.grade !== "string" ||
                !result.categories ||
                !Array.isArray(result.questions)
            ) {
                throw new Error("AI returned an invalid grading result.");
            }

            if (result.score < 0 || result.score > 100) {
                throw new Error("AI returned an invalid score.");
            }

            res.json(result);

        } catch (error) {
            console.error("GRADING ERROR:", error.message);

            if (error.message.includes("timed out")) {
                return res.status(504).json({
                    error: "The AI took too long to respond. Please try again."
                });
            }

            res.status(500).json({
                error: "Could not evaluate the assignment. Please try again."
            });
        }
    }
);

app.get("/", (req, res) => {
    res.json({
        message: "Rate My Assignment backend is running!"
    });
});

app.use((error, req, res, next) => {
    console.error("SERVER ERROR:", error.message);

    res.status(500).json({
        error: "Something went wrong on the server."
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});