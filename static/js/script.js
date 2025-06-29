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
        const fileNames = Array.from(docsFilesInput.files).map(f => f.name).join(', ');
        fileNameDisplay.textContent = fileNames || 'No files selected';
        if (fileNames) {
            fileNameDisplay.classList.add('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
            fileNameDisplay.classList.remove('text-slate-500');
        } else {
            fileNameDisplay.classList.remove('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
            fileNameDisplay.classList.add('text-slate-500');
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
            
            const sessionInList = sessionsList.querySelector(`[data-session-id="${activeSessionId}"]`);
            if (!sessionInList) {
                 fetchAllSessions(); 
            }

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
            if (confirm('Are you sure you want to delete this chat session?')) {
                deleteSession(sessionId);
            }
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
                allSessions.forEach(session => {
                    addSessionToList(session.session_id, session.file_names);
                });
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
            data.chat_history.forEach(msg => appendMessageToChat(msg.content, msg.role));
            if (data.chat_history.length === 0) {
                 appendMessageToChat(`Hello! I'm ready to answer questions about ${data.file_names.join(', ')}.`, 'assistant');
            }
            
            enableChatInput(true);
            updateActiveSessionInList(sessionId);
            showStatus(`Active session: ${data.file_names.join(', ').substring(0, 30)}...`, 'success');

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

    function addSessionToList(sessionId, fileNames) {
        const noHistoryMsg = sessionsList.querySelector('.text-center');
        if (noHistoryMsg) noHistoryMsg.remove();

        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item flex items-center justify-between cursor-pointer p-2.5 rounded-lg transition-colors hover:bg-slate-200';
        sessionItem.dataset.sessionId = sessionId;

        const firstFileName = fileNames[0] || 'Chat Session';
        const displayName = firstFileName.length > 20 ? `${firstFileName.substring(0, 18)}...` : firstFileName;

        sessionItem.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <i class="material-icons text-slate-500">chat_bubble_outline</i>
                <div class="flex flex-col overflow-hidden">
                    <span class="font-medium text-sm text-slate-700 truncate" title="${firstFileName}">${displayName}</span>
                    <span class="text-xs text-slate-500">${fileNames.length} file(s)</span>
                </div>
            </div>
            <button class="delete-session-btn flex-shrink-0 w-8 h-8 flex justify-center items-center -mr-0.5 rounded-full hover:bg-slate-300 text-slate-500 hover:text-slate-600 transition-colors" title="Delete Session">
                <i class="material-icons text-2xl leading-none">delete_outline</i>
            </button>
        `;
        sessionsList.prepend(sessionItem);
    }
    
    function updateActiveSessionInList(sessionId) {
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('bg-indigo-100', item.dataset.sessionId === sessionId);
            item.classList.toggle('hover:bg-slate-200', item.dataset.sessionId !== sessionId);
        });
    }

    function clearChatBox() {
        chatBox.innerHTML = '';
        const welcomeHeader = document.createElement('div');
        welcomeHeader.className = 'chat-header py-10 px-8 bg-white text-center';
        welcomeHeader.innerHTML = `
            <h1 class="m-0 mb-1.5 text-4xl text-slate-400 font-semibold">Chat with your Documents</h1>
            <p class="m-0 text-sm text-slate-500">Upload new documents or select a previous chat from the history.</p>
        `;
        chatBox.appendChild(welcomeHeader);
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = 'mt-4 font-medium h-6 truncate';
        const colorClass = type === 'error' ? 'text-red-700' : (type === 'success' ? 'text-indigo-700' : 'text-slate-800');
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
});
