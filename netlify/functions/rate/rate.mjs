import { GoogleGenAI } from "@google/genai";
import Busboy from "busboy";

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

function parseMultipart(request) {
    return new Promise(async (resolve, reject) => {
        const contentType = request.headers.get("content-type");

        if (!contentType) {
            return reject(new Error("Missing content type."));
        }

        const busboy = Busboy({
            headers: {
                "content-type": contentType
            },
            limits: {
                fileSize: 10 * 1024 * 1024,
                files: 1
            }
        });

        let file = null;
        let instructions = "";
        let fileTooLarge = false;

        busboy.on("file", (fieldname, stream, info) => {
            const chunks = [];

            stream.on("data", chunk => {
                chunks.push(chunk);
            });

            stream.on("limit", () => {
                fileTooLarge = true;
            });

            stream.on("end", () => {
                file = {
                    buffer: Buffer.concat(chunks),
                    filename: info.filename,
                    mimeType: info.mimeType
                };
            });
        });

        busboy.on("field", (name, value) => {
            if (name === "instructions") {
                instructions = value;
            }
        });

        busboy.on("finish", () => {
            if (fileTooLarge) {
                return reject(new Error("File is too large. Maximum size is 10 MB."));
            }

            resolve({ file, instructions });
        });

        busboy.on("error", reject);

        const body = Buffer.from(await request.arrayBuffer());
        busboy.end(body);
    });
}

export default async (request) => {
    if (request.method !== "POST") {
        return new Response(
            JSON.stringify({
                error: "Method not allowed."
            }),
            {
                status: 405,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }

    try {
        const { file, instructions } = await parseMultipart(request);

        if (!file) {
            return new Response(
                JSON.stringify({
                    error: "Please upload an assignment."
                }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        if (instructions.length > 2000) {
            return new Response(
                JSON.stringify({
                    error: "Additional instructions must be 2000 characters or less."
                }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        const allowedMimeTypes = new Set([
            "application/pdf",
            "text/plain",
            "image/jpeg",
            "image/png"
        ]);

        if (!allowedMimeTypes.has(file.mimeType)) {
            return new Response(
                JSON.stringify({
                    error: "Unsupported file type."
                }),
                {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

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
${instructions.trim() || "None"}

Return the evaluation as structured JSON.

The overall score must be out of 100.
Each category score must be out of 20.
Each individual question score must be out of 20.
Be honest, specific, and academically reasonable.
`;

        const response = await Promise.race([
            ai.models.generateContent({
                model: "gemini-3.6-flash",
                contents: [
                    {
                        text: prompt
                    },
                    {
                        inlineData: {
                            mimeType: file.mimeType,
                            data: file.buffer.toString("base64")
                        }
                    }
                ],
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
                    reject(new Error("AI request timed out. Please try again."));
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

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        });

    } catch (error) {
        console.error("GRADING ERROR:", error.message);

        if (error.message.includes("timed out")) {
            return new Response(
                JSON.stringify({
                    error: "The AI took too long to respond. Please try again."
                }),
                {
                    status: 504,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        return new Response(
            JSON.stringify({
                error: "Could not evaluate the assignment. Please try again."
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
};