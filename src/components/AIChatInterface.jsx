/*
 * AIChatInterface.jsx - AI Chat Component for Code Reading and Analysis
 * 
 * Features:
 * - File reference with @filename syntax
 * - Project context awareness
 * - Integration with Gemini/OpenRouter APIs
 * - Code analysis and explanation
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, FileText, Bot, User, Loader2, AlertCircle, Copy, Check } from 'lucide-react';
import { api } from '../utils/api';

function AIChatInterface({ selectedProject, onFileOpen }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [projectOverview, setProjectOverview] = useState(null);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [aiConfig, setAiConfig] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [configError, setConfigError] = useState(null);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    let isMounted = true;

    const fetchConfig = async () => {
      try {
        const response = await api.ai.config();
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!isMounted) return;

        setAiConfig(data);

        const availableIds = (data.availableModels || []).map((option) => option.id).filter(Boolean);
        const savedModel = localStorage.getItem('ai-chat-model');

        if (savedModel && availableIds.includes(savedModel)) {
          setSelectedModel(savedModel);
        } else if (data.model) {
          setSelectedModel(data.model);
          if (availableIds.includes(data.model)) {
            localStorage.setItem('ai-chat-model', data.model);
          }
        } else {
          setSelectedModel('');
        }

        setConfigError(null);
      } catch (err) {
        console.error('Failed to load AI configuration:', err);
        if (!isMounted) return;
        setAiConfig(null);
        setSelectedModel('');
        setConfigError('AI configuration is unavailable.');
      }
    };

    fetchConfig();

    return () => {
      isMounted = false;
    };
  }, []);

  // Load project overview and files when project changes
  useEffect(() => {
    if (selectedProject) {
      loadProjectContext();
    }
  }, [selectedProject]);

  const loadProjectContext = async () => {
    try {
      // Load project overview from localStorage
      const savedOverview = localStorage.getItem(`project_overview_${selectedProject.name}`);
      if (savedOverview) {
        setProjectOverview(JSON.parse(savedOverview));
      } else {
        // Generate initial project overview
        await generateProjectOverview();
      }

      // Load available files for reference
      await loadAvailableFiles();
    } catch (error) {
      console.error('Error loading project context:', error);
      setError('Failed to load project context');
    }
  };

  const generateProjectOverview = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        const overview = {
          projectName: selectedProject.name,
          displayName: selectedProject.displayName,
          path: selectedProject.path,
          fileCount: files.length,
          structure: analyzeProjectStructure(files),
          mainFiles: identifyMainFiles(files),
          technologies: detectTechnologies(files),
          lastUpdated: new Date().toISOString()
        };
        
        setProjectOverview(overview);
        localStorage.setItem(`project_overview_${selectedProject.name}`, JSON.stringify(overview));
      }
    } catch (error) {
      console.error('Error generating project overview:', error);
    }
  };

  const analyzeProjectStructure = (files) => {
    const structure = {
      directories: new Set(),
      fileTypes: {},
      totalFiles: files.length
    };

    files.forEach(file => {
      // Extract directories
      const pathParts = file.path.split('/');
      if (pathParts.length > 1) {
        structure.directories.add(pathParts[0]);
      }

      // Count file types
      const extension = file.path.split('.').pop()?.toLowerCase();
      if (extension) {
        structure.fileTypes[extension] = (structure.fileTypes[extension] || 0) + 1;
      }
    });

    return {
      ...structure,
      directories: Array.from(structure.directories)
    };
  };

  const identifyMainFiles = (files) => {
    const mainFiles = [];
    const priorityPatterns = [
      /package\.json$/,
      /README\.md$/i,
      /index\.(js|ts|jsx|tsx)$/,
      /main\.(js|ts|jsx|tsx)$/,
      /app\.(js|ts|jsx|tsx)$/,
      /App\.(js|ts|jsx|tsx)$/,
      /\.config\.(js|ts|json)$/,
      /vite\.config\.(js|ts)$/,
      /webpack\.config\.(js|ts)$/
    ];

    files.forEach(file => {
      if (priorityPatterns.some(pattern => pattern.test(file.path))) {
        mainFiles.push({
          path: file.path,
          name: file.path.split('/').pop(),
          type: 'main'
        });
      }
    });

    return mainFiles.slice(0, 10); // Limit to top 10
  };

  const detectTechnologies = (files) => {
    const technologies = new Set();
    
    files.forEach(file => {
      const extension = file.path.split('.').pop()?.toLowerCase();
      const filename = file.path.split('/').pop().toLowerCase();
      
      // Detect technologies based on file extensions and names
      if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
        technologies.add('JavaScript/TypeScript');
      }
      if (['py'].includes(extension)) {
        technologies.add('Python');
      }
      if (['java'].includes(extension)) {
        technologies.add('Java');
      }
      if (['go'].includes(extension)) {
        technologies.add('Go');
      }
      if (['rs'].includes(extension)) {
        technologies.add('Rust');
      }
      if (filename === 'package.json') {
        technologies.add('Node.js');
      }
      if (filename === 'requirements.txt' || filename === 'pyproject.toml') {
        technologies.add('Python');
      }
      if (filename === 'cargo.toml') {
        technologies.add('Rust');
      }
      if (filename === 'go.mod') {
        technologies.add('Go');
      }
    });

    return Array.from(technologies);
  };

  const loadAvailableFiles = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        setAvailableFiles(files.map(file => ({
          path: file.path,
          name: file.path.split('/').pop(),
          fullPath: file.path
        })));
      }
    } catch (error) {
      console.error('Error loading available files:', error);
    }
  };

  const handleFileReference = (inputText) => {
    // Parse @filename references
    const fileReferences = [];
    const fileRefRegex = /@([^\s]+)/g;
    let match;
    
    while ((match = fileRefRegex.exec(inputText)) !== null) {
      const reference = match[1];
      const matchedFile = availableFiles.find(file => 
        file.name.toLowerCase().includes(reference.toLowerCase()) ||
        file.path.toLowerCase().includes(reference.toLowerCase())
      );
      
      if (matchedFile) {
        fileReferences.push(matchedFile);
      }
    }
    
    return fileReferences;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    };

    // Check for file references
    const fileReferences = handleFileReference(input);
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      // Prepare context for AI
      const context = {
        projectOverview,
        fileReferences,
        availableFiles: availableFiles.slice(0, 50), // Limit to prevent token overflow
        userMessage: input.trim()
      };

      const payload = {
        message: input.trim(),
        context,
        projectName: selectedProject.name
      };

      if (showModelSelector && selectedModel) {
        payload.model = selectedModel;
      }

      const response = await api.ai.chat(payload);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      const aiMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: data.response,
        timestamp: new Date().toISOString(),
        fileReferences: fileReferences
      };

      setMessages(prev => [...prev, aiMessage]);

      // Update project overview if AI suggests changes
      if (data.updatedOverview) {
        setProjectOverview(data.updatedOverview);
        localStorage.setItem(`project_overview_${selectedProject.name}`, JSON.stringify(data.updatedOverview));
      }

    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message. Please try again.');
      
      const errorMessage = {
        id: Date.now() + 1,
        type: 'error',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (content, messageId) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const handleFileClick = (filePath) => {
    if (onFileOpen) {
      onFileOpen(filePath);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const providerLabel = aiConfig?.provider === 'gemini'
    ? 'Gemini'
    : aiConfig?.provider === 'openrouter'
    ? 'OpenRouter'
    : aiConfig?.provider;

  const modelOptions = aiConfig?.availableModels || [];
  const showModelSelector = Boolean(
    aiConfig?.configured &&
    aiConfig.provider === 'gemini' &&
    modelOptions.length > 0
  );

  const handleModelChange = useCallback((newModel) => {
    const validIds = modelOptions.map((option) => option.id);
    if (!validIds.includes(newModel)) {
      return;
    }

    setSelectedModel(newModel);
    localStorage.setItem('ai-chat-model', newModel);
  }, [modelOptions]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <Bot className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold mb-2">AI Code Assistant</h3>
          <p>Select a project to start asking questions about your code</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                AI Code Assistant
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ask questions about {selectedProject.displayName}
              </p>
              {aiConfig?.configured && providerLabel && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Using {providerLabel}
                  {showModelSelector && selectedModel ? ` • ${selectedModel}` : ''}
                </p>
              )}
              {configError && (
                <p className="text-xs text-red-500 mt-1">{configError}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {showModelSelector && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wide">Model</span>
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="bg-transparent text-sm font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
                >
                  {modelOptions.map((option) => (
                    <option
                      key={option.id}
                      value={option.id}
                      title={option.description || option.label || option.id}
                    >
                      {option.label || option.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={clearChat}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            >
              Clear Chat
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <Bot className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold mb-2">Welcome to AI Code Assistant</h3>
            <p className="mb-4">Ask me anything about your codebase:</p>
            <div className="text-left max-w-md mx-auto space-y-2">
              <p className="text-sm">• "Explain the main structure of this project"</p>
              <p className="text-sm">• "What does @App.jsx do?"</p>
              <p className="text-sm">• "How does authentication work here?"</p>
              <p className="text-sm">• "Find all API endpoints"</p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.type !== 'user' && (
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                {message.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                ) : (
                  <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                )}
              </div>
            )}
            
            <div
              className={`max-w-3xl rounded-lg px-4 py-3 ${
                message.type === 'user'
                  ? 'bg-blue-600 text-white'
                  : message.type === 'error'
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
              }`}
            >
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
              
              {/* File references */}
              {message.fileReferences && message.fileReferences.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Referenced files:</p>
                  <div className="flex flex-wrap gap-2">
                    {message.fileReferences.map((file, index) => (
                      <button
                        key={index}
                        onClick={() => handleFileClick(file.fullPath)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        {file.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Copy button */}
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => copyToClipboard(message.content, message.id)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                >
                  {copiedMessageId === message.id ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {message.type === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your code... (use @filename to reference files)"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            {availableFiles.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                <div className="p-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  Available files (use @filename to reference):
                </div>
                {availableFiles.slice(0, 10).map((file, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setInput(prev => prev + ` @${file.name}`)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{file.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
        
        {error && (
          <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIChatInterface;