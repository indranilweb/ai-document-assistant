document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const uploadForm = document.getElementById('upload-form');
    const chatForm = document.getElementById('chat-form');
    const pdfFilesInput = document.getElementById('pdf-files');
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


    // --- Event Listeners ---

    // Update file name display on file selection
    pdfFilesInput.addEventListener('change', () => {
        const fileNames = Array.from(pdfFilesInput.files).map(f => f.name).join(', ');
        fileNameDisplay.textContent = fileNames || 'No files selected';
        if (fileNames) {
            fileNameDisplay.classList.add('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
            fileNameDisplay.classList.remove('text-slate-500');
        } else {
            fileNameDisplay.classList.remove('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
            fileNameDisplay.classList.add('text-slate-500');
        }
    });

    // Handle PDF processing
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (pdfFilesInput.files.length === 0) {
            showStatus('Please select at least one PDF file.', 'error');
            return;
        }
        const formData = new FormData(uploadForm);
        await processNewSession(formData);
    });

    // Handle sending a chat message
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

        } catch (error) {
            updateThinkingIndicator(thinkingIndicator, `Sorry, an error occurred: ${error.message}`, 'error');
        } finally {
            enableChatInput(true);
            userQuestionInput.focus();
        }
    });

    // Handle clicks on session items
    sessionsList.addEventListener('click', (e) => {
        const sessionItem = e.target.closest('.session-item');
        if (sessionItem && sessionItem.dataset.sessionId !== activeSessionId) {
            switchSession(sessionItem.dataset.sessionId);
        }
    });


    // --- Core Functions ---

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
            const response = await fetch('/process_pdfs', { method: 'POST', body: formData });
            clearInterval(interval);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to process PDFs.');
            
            progressBarInner.style.width = '100%';
            progressLabel.textContent = 'Processing Complete!';
            addSessionToList(data.session_id, data.file_names);
            switchSession(data.session_id); // Automatically switch to the new session
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
        }
    }


    // --- UI Update Functions ---

    function addSessionToList(sessionId, fileNames) {
        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item cursor-pointer p-2.5 rounded-lg transition-colors hover:bg-slate-200';
        sessionItem.dataset.sessionId = sessionId;

        const firstFileName = fileNames[0] || 'Chat Session';
        const displayName = firstFileName.length > 20 ? `${firstFileName.substring(0, 18)}...` : firstFileName;

        sessionItem.innerHTML = `
            <div class="flex items-center gap-3">
                <i class="material-icons text-slate-500">chat_bubble_outline</i>
                <div class="flex flex-col">
                    <span class="font-medium text-sm text-slate-700">${displayName}</span>
                    <span class="text-xs text-slate-500">${fileNames.length} file(s)</span>
                </div>
            </div>
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
        // Remove initial welcome header if it exists
        const welcomeHeader = chatBox.querySelector('.chat-header');
        if (welcomeHeader) welcomeHeader.remove();

        const messageWrapper = document.createElement('div');
        messageWrapper.className = `flex w-full ${role === 'user' ? 'justify-end' : 'justify-start'}`;

        const contentDiv = document.createElement('div');
        let contentClasses = 'p-3 rounded-2xl max-w-[75%] prose';
        
        if (role === 'user') {
            contentClasses += ' bg-indigo-600 text-white rounded-br-none';
            contentDiv.textContent = content;
        } else {
            contentClasses += ' bg-slate-200 text-slate-800 rounded-bl-none';
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
            <div class="p-3 rounded-2xl rounded-bl-none bg-slate-200 text-slate-800">
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
        let contentClasses = 'p-3 rounded-2xl max-w-[75%] prose rounded-bl-none';
        contentClasses += newRole.includes('error') ? ' bg-red-100 text-red-700' : ' bg-slate-200 text-slate-800';
        indicatorElement.innerHTML = `<div class="${contentClasses}">${converter.makeHtml(newContent)}</div>`;
    }
});