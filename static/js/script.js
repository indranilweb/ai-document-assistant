document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const uploadForm = document.getElementById('upload-form');
    const chatForm = document.getElementById('chat-form');
    const docsFilesInput = document.getElementById('docs-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const userQuestionInput = document.getElementById('user-question');
    const chatBox = document.getElementById('chat-box');
    const statusMessage = document.getElementById('status-message');
    const sendBtn = document.getElementById('send-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBarInner = document.getElementById('progress-bar-inner');
    const progressLabel = document.getElementById('progress-label');
    const sessionsList = document.getElementById('sessions-list');

    // --- State Management ---
    let activeSessionId = null;

    // --- Initialize Showdown for Markdown ---
    const converter = new showdown.Converter();

    // --- Initial UI Setup ---
    clearChatBox();
    fetchAllSessions(); 

    // --- Event Listeners ---
    docsFilesInput.addEventListener('change', () => {
        const files = Array.from(docsFilesInput.files);
        const fileNames = files.map(f => f.name).join(', ');
        
        if (files.length > 0) {
            fileNameDisplay.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-icons text-xs text-blue-400">description</span>
                    <span class="text-white font-medium">${files.length} file${files.length > 1 ? 's' : ''} selected</span>
                </div>
                <div class="text-xs text-slate-300 mt-1 truncate">${fileNames}</div>
            `;
            fileNameDisplay.classList.add('bg-blue-500/20', 'border-blue-400/50');
            fileNameDisplay.classList.remove('bg-slate-800/50', 'border-slate-700');
        } else {
            fileNameDisplay.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-icons text-xs">description</span>
                    <span>No files selected</span>
                </div>
            `;
            fileNameDisplay.classList.remove('bg-blue-500/20', 'border-blue-400/50');
            fileNameDisplay.classList.add('bg-slate-800/50', 'border-slate-700');
        }
    });

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (docsFilesInput.files.length === 0) {
            showStatus('Please select at least one file.', 'error');
            return;
        }
        await processNewSession(new FormData(uploadForm));
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const question = userQuestionInput.value.trim();
        if (!question || !activeSessionId) return;

        appendMessageToChat(question, 'user');
        userQuestionInput.value = '';
        enableChatInput(false);
        const thinkingIndicator = showThinkingIndicator();

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: activeSessionId, user_question: question }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to get a response.');
            
            updateThinkingIndicator(thinkingIndicator, data.answer, 'assistant');
            
            // Re-fetch all sessions to ensure timestamp update is reflected and list is re-sorted
            fetchAllSessions(); 

        } catch (error) {
            updateThinkingIndicator(thinkingIndicator, `Sorry, an error occurred: ${error.message}`, 'error');
        } finally {
            enableChatInput(true);
            userQuestionInput.focus();
        }
    });

    // --- Combined Event Listener for Session List (Select and Delete) ---
    sessionsList.addEventListener('click', (e) => {
        const sessionItem = e.target.closest('.session-item');
        if (!sessionItem) return; // Exit if click was not inside a session item

        const deleteBtn = e.target.closest('.delete-session-btn');
        const sessionId = sessionItem.dataset.sessionId;

        if (deleteBtn) {
            // Use a simple confirmation before deleting
            // Replaced alert/confirm with a custom modal for better UX
            showCustomConfirm('Are you sure you want to delete this chat session?', () => {
                deleteSession(sessionId);
            });
        } else if (sessionId !== activeSessionId) {
            // If not deleting, and it's a new session, switch to it
            switchSession(sessionId);
        }
    });


    // --- Core Functions ---

    async function fetchAllSessions() {
        try {
            const response = await fetch('/get_all_sessions');
            if (!response.ok) throw new Error('Failed to load sessions from server.');
            const allSessions = await response.json();
            
            sessionsList.innerHTML = ''; // Clear the list before repopulating
            if (allSessions.length === 0) {
                sessionsList.innerHTML = `<div class="text-center text-sm text-slate-500 p-4">No chat history found.</div>`;
            } else {
                // Sessions are already sorted by timestamp from the backend
                allSessions.forEach(session => {
                    addSessionToList(session.session_id, session.file_names, session.timestamp);
                });
            
                // If there's an active session, highlight it
                updateActiveSessionInList(activeSessionId);
            }
        } catch (error) {
            console.error('Error fetching sessions:', error);
            sessionsList.innerHTML = `<div class="text-center text-sm text-red-500 p-4">Could not load history.</div>`;
        }
    }


    async function processNewSession(formData) {
        showStatus('', 'info');
        progressContainer.style.display = 'block';
        progressBarInner.style.width = '0%';
        progressLabel.textContent = 'Uploading and processing...';
        
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress < 95) progressBarInner.style.width = `${progress}%`;
        }, 500);

        try {
            const response = await fetch('/process_files', { method: 'POST', body: formData });
            clearInterval(interval);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to process documents.');
            
            progressBarInner.style.width = '100%';
            progressLabel.textContent = 'Processing Complete!';
            await fetchAllSessions(); 
            switchSession(data.session_id); 
            
            setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);

        } catch (error) {
            clearInterval(interval);
            progressContainer.style.display = 'none';
            showStatus(`Error: ${error.message}`, 'error');
        }
    }

    async function switchSession(sessionId) {
        try {
            const response = await fetch(`/get_session/${sessionId}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to load session.');

            activeSessionId = sessionId;
            clearChatBox();
            if (data.chat_history.length === 0) {
                 appendMessageToChat(`Hello! I'm ready to answer questions about **${data.file_names.join('**, **').replaceAll('_', '\\_')}**.`, 'assistant');
            } else {
                appendMessageToChat(`Hello! Your questions about **${data.file_names.join('**, **').replaceAll('_', '\\_')}**.`, 'assistant');
            }
            data.chat_history.forEach(msg => appendMessageToChat(msg.content, msg.role));
            
            enableChatInput(true);
            updateActiveSessionInList(sessionId);
            showStatus(`Active session: ${data.file_names.join(', ')}`, 'success');

        } catch (error) {
            showStatus(`Error switching session: ${error.message}`, 'error');
            enableChatInput(false);
        }
    }

    // --- NEW: Function to handle session deletion ---
    async function deleteSession(sessionId) {
        try {
            const response = await fetch(`/delete_session/${sessionId}`, {
                method: 'DELETE',
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to delete session.');

            // Remove from UI
            const sessionItem = sessionsList.querySelector(`[data-session-id="${sessionId}"]`);
            if (sessionItem) sessionItem.remove();

            // If the deleted session was active, reset the chat view
            if (activeSessionId === sessionId) {
                activeSessionId = null;
                clearChatBox();
                enableChatInput(false);
                showStatus('Session deleted.', 'info');
            }
            
            // If no sessions are left, show the placeholder message
            if (sessionsList.children.length === 0) {
                sessionsList.innerHTML = `<div class="text-center text-sm text-slate-500 p-4">No chat history found.</div>`;
            }

        } catch (error) {
            console.error('Error deleting session:', error);
            showStatus(`Error: ${error.message}`, 'error');
        }
    }


    // --- UI Helper Functions ---

    function addSessionToList(sessionId, fileNames, timestamp) {
        const noHistoryMsg = sessionsList.querySelector('.text-center');
        if (noHistoryMsg) noHistoryMsg.remove();

        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item group flex items-center justify-between cursor-pointer space-x-1 p-2.5 rounded-xl transition-colors duration-200 hover:bg-slate-700/50';
        sessionItem.dataset.sessionId = sessionId;

        const firstFileName = fileNames[0] || 'Chat Session';
        const displayName = firstFileName.length > 20 ? `${firstFileName.substring(0, 18)}...` : firstFileName;
        const allFileNames = fileNames.join(', ') || 'Chat Session';

        // Format timestamp for display
        const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
        const formattedDate = date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        sessionItem.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-slate-600 flex items-center justify-center flex-shrink-0">
                    <span class="material-icons text-slate-300 text-sm">description</span>
                </div>
                <div class="flex flex-col overflow-hidden">
                    <span class="font-medium text-sm text-slate-50 truncate" title="${allFileNames}">${allFileNames}</span>
                    <span class="text-xs text-slate-400">${fileNames.length} document${fileNames.length > 1 ? 's' : ''}</span>
                </div>
            </div>
            <button class="delete-session-btn flex-shrink-0 w-8 h-8 flex justify-center items-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-all duration-200" title="Delete Session">
                <i class="material-icons text-2xl leading-none">delete_outline</i>
            </button>
        `;
        // Append to ensure newest is on top, as the backend already sorts
        sessionsList.append(sessionItem);
    }
    
    function updateActiveSessionInList(sessionId) {
        document.querySelectorAll('.session-item').forEach(item => {
            if (item.dataset.sessionId === sessionId) {
                item.classList.add('bg-blue-500/20', 'border', 'border-blue-400/30');
                item.classList.remove('hover:bg-slate-700/50');
            } else {
                item.classList.remove('bg-blue-500/20', 'border', 'border-blue-400/30');
                item.classList.add('hover:bg-slate-700/50');
            }
        });
    }

    function clearChatBox() {
        chatBox.innerHTML = '';
        const welcomeHeader = document.createElement('div');
        welcomeHeader.className = 'chat-header flex-grow flex flex-col items-center justify-center text-center p-12';
        welcomeHeader.innerHTML = `
            <i class="material-icons text-transparent text-6xl bg-gradient-to-br from-sky-400 via-indigo-400 to-pink-500 bg-clip-text">textsms</i><h1 class="text-4xl font-bold text-slate-500 mb-4 gradient-text">Chat with your Documents</h1>
            <p class="text-slate-500 text-lg mb-8 max-w-md leading-relaxed">Upload new documents or select a previous conversation from your chat history to get started.</p>
            <div class="flex gap-4 text-sm text-slate-500">
                <div class="flex items-center gap-2">
                    <span class="material-icons text-lg">description</span>
                    <span>PDF, DOCX, TXT</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="material-icons text-lg">psychology</span>
                    <span>AI-Powered</span>
                </div>
            </div>
        `;
        chatBox.appendChild(welcomeHeader);
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.title = message;
        statusMessage.className = 'text-sm font-medium h-5 truncate';
        const colorClass = type === 'error' ? 'text-red-400' : (type === 'success' ? 'text-sky-400' : 'text-slate-300');
        statusMessage.classList.add(colorClass);
    }
    
    function enableChatInput(enabled) {
        userQuestionInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
        if(enabled) userQuestionInput.focus();
    }

    function appendMessageToChat(content, role) {
        const welcomeHeader = chatBox.querySelector('.chat-header');
        if (welcomeHeader) welcomeHeader.remove();

        const messageWrapper = document.createElement('div');
        messageWrapper.className = `flex w-full ${role === 'user' ? 'justify-end' : 'justify-start'}`;

        const contentDiv = document.createElement('div');
        let contentClasses = 'p-3 rounded-2xl max-w-[75%] prose';
        
        if (role === 'user') {
            contentClasses += ' bg-indigo-600 text-white rounded-br-sm';
            contentDiv.textContent = content;
        } else {
            contentClasses += ' bg-slate-200 text-slate-800 rounded-bl-sm';
            if (role.includes('error')) contentClasses += ' bg-red-100 text-red-700';
            contentDiv.innerHTML = converter.makeHtml(content);
        }
        
        contentDiv.className = contentClasses;
        messageWrapper.appendChild(contentDiv);
        chatBox.appendChild(messageWrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function showThinkingIndicator() {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex justify-start w-full';
        wrapper.id = 'thinking-indicator';
        wrapper.innerHTML = `
            <div class="p-3 rounded-2xl rounded-bl-sm bg-slate-200 text-slate-800">
                <div class="flex items-center gap-2 italic">
                    <span>Thinking</span>
                    <div class="flex gap-1">
                        <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
                        <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
                        <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
                    </div>
                </div>
            </div>
        `;
        chatBox.appendChild(wrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
        return wrapper;
    }

    function updateThinkingIndicator(indicatorElement, newContent, newRole) {
        let contentClasses = 'p-3 rounded-2xl max-w-[75%] prose rounded-bl-sm';
        contentClasses += newRole.includes('error') ? ' bg-red-100 text-red-700' : ' bg-slate-200 text-slate-800';
        indicatorElement.innerHTML = `<div class="${contentClasses}">${converter.makeHtml(newContent)}</div>`;
    }

    // --- Custom Confirmation Modal (replaces alert/confirm) ---
    function showCustomConfirm(message, onConfirm) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.id = 'custom-confirm-overlay';
        overlay.className = 'fixed inset-0 backdrop-blur bg-slate-500/30 flex items-center justify-center z-50';

        // Create modal content
        const modal = document.createElement('div');
        modal.className = 'bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center';
        modal.innerHTML = `
            <p class="text-lg font-semibold mb-4">${message}</p>
            <div class="flex justify-center gap-4">
                <button id="confirm-yes" class="px-5 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors">Yes</button>
                <button id="confirm-no" class="px-5 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors">No</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Add event listeners for buttons
        document.getElementById('confirm-yes').addEventListener('click', () => {
            onConfirm();
            overlay.remove();
        });

        document.getElementById('confirm-no').addEventListener('click', () => {
            overlay.remove();
        });
    }
});
