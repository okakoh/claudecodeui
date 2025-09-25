/*
 * AI Routes - API endpoints for AI chat functionality
 *
 * Supports:
 * - Gemini API integration
 * - OpenRouter API integration
 * - File context management
 * - Project overview generation
 */

import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// AI Provider configurations
const AI_PROVIDERS = {
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-1.5-flash-002',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    })
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.1-405b-instruct',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost:3001',
      'X-Title': process.env.OPENROUTER_TITLE || 'Claude Code UI'
    })
  }
};

// Get AI configuration from environment
function getAIConfig() {
  const provider = process.env.AI_PROVIDER || 'gemini';
  const providerConfig = AI_PROVIDERS[provider];

  if (!providerConfig) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    throw new Error(`AI_API_KEY environment variable is required for ${providerConfig.name}`);
  }

  const modelOverride =
    provider === 'gemini' ? process.env.GEMINI_MODEL : process.env.OPENROUTER_MODEL;
  const model = modelOverride || providerConfig.defaultModel;

  return {
    provider,
    config: providerConfig,
    apiKey,
    model
  };
}

// Generate system prompt for code analysis
function generateSystemPrompt(projectOverview, fileReferences) {
  let prompt = `You are an AI code assistant specialized in analyzing and explaining codebases. You have access to project context and can reference specific files.

Project Context:
- Name: ${projectOverview?.projectName || 'Unknown'}
- Display Name: ${projectOverview?.displayName || 'Unknown'}
- Technologies: ${projectOverview?.technologies?.join(', ') || 'Unknown'}
- File Count: ${projectOverview?.fileCount || 0}

`;

  if (fileReferences && fileReferences.length > 0) {
    prompt += `Referenced Files:
${fileReferences.map(file => `- ${file.path}`).join('\n')}

`;
  }

  prompt += `Instructions:
1. Provide clear, helpful explanations about code structure and functionality
2. When referencing files, use the exact file paths provided
3. Explain complex code patterns in simple terms
4. Suggest improvements when appropriate
5. Be concise but thorough
6. If you need to see file contents, ask the user to reference them with @filename

Always be helpful and focus on code understanding and best practices.`;

  return prompt;
}

// Prepare messages for AI API
function prepareMessages(userMessage, systemPrompt, fileContents = []) {
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  // Add file contents if provided
  if (fileContents.length > 0) {
    const fileContext = fileContents.map(file => 
      `File: ${file.path}\n\`\`\`${file.extension || 'text'}\n${file.content}\n\`\`\``
    ).join('\n\n');
    
    messages.push({
      role: 'user',
      content: `Here are the referenced files:\n\n${fileContext}\n\nUser question: ${userMessage}`
    });
  } else {
    messages.push({
      role: 'user',
      content: userMessage
    });
  }

  return messages;
}

// Call AI API
async function callAI(messages, config) {
  const { provider, config: providerConfig, apiKey, model } = config;
  
  let requestBody;
  let url;
  
  if (provider === 'gemini') {
    // Gemini API format
    url = `${providerConfig.baseUrl}/${model}:generateContent`;
    
    // Convert messages to Gemini format
    const contents = messages.filter(msg => msg.role !== 'system').map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));
    
    requestBody = {
      contents,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    };
    
    // Add system instruction if present
    const systemMessage = messages.find(msg => msg.role === 'system');
    if (systemMessage) {
      requestBody.systemInstruction = {
        parts: [{ text: systemMessage.content }]
      };
    }
  } else if (provider === 'openrouter') {
    // OpenRouter API format
    url = `${providerConfig.baseUrl}/chat/completions`;

    requestBody = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2048
    };
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: providerConfig.headers(apiKey),
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API request failed: ${response.status} ${errorText}`);
  }
  
  const data = await response.json();
  
  // Extract response based on provider
  if (provider === 'gemini') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
  } else if (provider === 'openrouter') {
    return data.choices?.[0]?.message?.content || 'No response generated';
  }
  
  throw new Error('Unknown AI provider');
}

// Read file contents
const PROJECT_RESOLVE_CACHE = new Map();

function getResolvedProjectPath(projectPath) {
  if (!PROJECT_RESOLVE_CACHE.has(projectPath)) {
    PROJECT_RESOLVE_CACHE.set(projectPath, path.resolve(projectPath));
  }
  return PROJECT_RESOLVE_CACHE.get(projectPath);
}

function isPathWithinProject(projectPath, targetPath) {
  const normalizedProjectPath = getResolvedProjectPath(projectPath);
  const resolvedTarget = path.resolve(projectPath, targetPath);

  return (
    resolvedTarget === normalizedProjectPath ||
    resolvedTarget.startsWith(`${normalizedProjectPath}${path.sep}`)
  );
}

// Read file contents
async function readFileContents(projectPath, fileReferences) {
  const contents = [];

  for (const fileRef of fileReferences) {
    try {
      if (path.isAbsolute(fileRef.path)) {
        throw new Error('Absolute paths are not allowed');
      }

      if (!isPathWithinProject(projectPath, fileRef.path)) {
        throw new Error('Referenced path is outside of the project directory');
      }

      const filePath = path.resolve(projectPath, fileRef.path);
      const content = await fs.readFile(filePath, 'utf8');
      const extension = path.extname(fileRef.path).slice(1);

      contents.push({
        path: fileRef.path,
        content: content.slice(0, 10000), // Limit file size to prevent token overflow
        extension
      });
    } catch (error) {
      console.error(`Error reading file ${fileRef.path}:`, error);
      contents.push({
        path: fileRef.path,
        content: `Error reading file: ${error.message}`,
        extension: 'text'
      });
    }
  }
  
  return contents;
}

// POST /api/ai/chat - Main AI chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message, context = {}, projectName } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get AI configuration
    const aiConfig = getAIConfig();
    
    // Generate system prompt
    const systemPrompt = generateSystemPrompt(context.projectOverview, context.fileReferences);
    
    // Read file contents if files are referenced
    let fileContents = [];
    if (Array.isArray(context.fileReferences) && context.fileReferences.length > 0) {
      // Find project path
      const { getProjects } = await import('../projects.js');
      const projects = await getProjects();
      const project = projects.find((p) => p.name === projectName);

      if (project) {
        fileContents = await readFileContents(project.path, context.fileReferences);
      }
    }
    
    // Prepare messages
    const messages = prepareMessages(message, systemPrompt, fileContents);
    
    // Call AI API
    const response = await callAI(messages, aiConfig);
    
    // Return response
    res.json({
      response,
      provider: aiConfig.provider,
      model: aiConfig.model,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process AI request',
      details: error.message 
    });
  }
});

// POST /api/ai/generate-overview - Generate project overview
router.post('/generate-overview', async (req, res) => {
  try {
    const { projectName, files } = req.body;
    
    if (!projectName || !files) {
      return res.status(400).json({ error: 'Project name and files are required' });
    }
    
    // Get AI configuration
    const aiConfig = getAIConfig();
    
    // Create system prompt for overview generation
    const systemPrompt = `You are an AI assistant that generates project overviews. Analyze the provided file structure and generate a comprehensive overview including:

1. Project type and purpose
2. Main technologies and frameworks
3. Key directories and their purposes
4. Entry points and main files
5. Architecture patterns
6. Dependencies and tools

Be concise but informative. Focus on helping developers understand the project structure quickly.`;

    // Prepare file structure for analysis
    const fileStructure = files.map(file => file.path).join('\n');
    const userMessage = `Analyze this project structure and generate an overview:\n\n${fileStructure}`;
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
    
    // Call AI API
    const response = await callAI(messages, aiConfig);
    
    res.json({
      overview: response,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('AI overview generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate project overview',
      details: error.message 
    });
  }
});

// GET /api/ai/config - Get AI configuration status
router.get('/config', (req, res) => {
  try {
    const config = getAIConfig();
    res.json({
      provider: config.provider,
      model: config.model,
      configured: true
    });
  } catch (error) {
    res.json({
      configured: false,
      error: error.message
    });
  }
});

export default router;