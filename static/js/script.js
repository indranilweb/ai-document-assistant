document.addEventListener('DOMContentLoaded', () => {
    // Element References
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

    let sessionId = null;

    // Initialize Showdown converter for Markdown
    const converter = new showdown.Converter();

    // Set initial greeting message
    appendMessage("Hello! Please upload your documents using the menu on the left and click 'Process' to begin.", 'assistant');

    // Update file name display on file selection
    pdfFilesInput.addEventListener('change', () => {
        if (pdfFilesInput.files.length > 0) {
            const fileNames = Array.from(pdfFilesInput.files).map(f => f.name).join(', ');
            fileNameDisplay.textContent = fileNames;
            fileNameDisplay.classList.add('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
            fileNameDisplay.classList.remove('text-gray-500');
        } else {
            fileNameDisplay.textContent = 'No files selected';
            fileNameDisplay.classList.add('text-gray-500');
            fileNameDisplay.classList.remove('bg-indigo-100', 'text-indigo-500', 'outline', 'outline-1', 'outline-indigo-200');
        }
    });

    // Handle PDF processing
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const files = pdfFilesInput.files;
        if (files.length === 0) {
            showStatus('Please select at least one PDF file.', 'error');
            return;
        }

        const formData = new FormData();
        for (const file of files) {
            formData.append('pdf_docs', file);
        }

        showStatus('', 'info');
        progressContainer.style.display = 'block';
        progressBarInner.style.width = '0%';
        progressLabel.textContent = 'Uploading and processing...';
        
        // Simulate progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress > 95) progress = 95;
            progressBarInner.style.width = `${progress}%`;
        }, 500);

        try {
            const response = await fetch('/process_pdfs', {
                method: 'POST',
                body: formData,
            });
            
            clearInterval(interval);
            const data = await response.json();

            if (response.ok) {
                sessionId = data.session_id;
                progressBarInner.style.width = '100%';
                progressLabel.textContent = 'Processing Complete!';
                showStatus('You can now ask questions.', 'success');
                enableChat(true);
                setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
            } else {
                throw new Error(data.error || 'Failed to process PDFs.');
            }
        } catch (error) {
            clearInterval(interval);
            progressContainer.style.display = 'none';
            showStatus(`Error: ${error.message}`, 'error');
            enableChat(false);
        }
    });

    // Handle sending a chat message
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const question = userQuestionInput.value.trim();
        if (!question || !sessionId) return;

        appendMessage(question, 'user');
        userQuestionInput.value = '';
        enableChat(false);

        const thinkingIndicator = showThinkingIndicator();

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    user_question: question,
                }),
            });

            const data = await response.json();
            
            if (response.ok) {
                updateThinkingIndicator(thinkingIndicator, data.answer, 'assistant');
            } else {
                throw new Error(data.error || 'Failed to get a response.');
            }
        } catch (error) {
            updateThinkingIndicator(thinkingIndicator, `Sorry, an error occurred: ${error.message}`, 'error');
        } finally {
            enableChat(true);
            userQuestionInput.focus();
        }
    });

    function showStatus(message, type) {
        statusMessage.textContent = message;
        // Reset classes and add new ones based on type
        statusMessage.className = 'mt-4 font-medium h-6';
        if (type === 'error') {
            statusMessage.classList.add('text-red-700');
        } else if (type === 'success') {
            statusMessage.classList.add('text-indigo-700');
        } else {
            statusMessage.classList.add('text-gray-800');
        }
    }
    
    function enableChat(enabled) {
        userQuestionInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
    }

    function appendMessage(content, role) {
        const messageWrapper = document.createElement('div');
        // Base message styles
        messageWrapper.className = 'flex w-full';

        const contentDiv = document.createElement('div');
        // Base content styles
        let contentClasses = 'p-3 rounded-2xl max-w-[75%] prose';
        
        if (role === 'user') {
            messageWrapper.classList.add('justify-end');
            contentClasses += ' bg-indigo-600 text-white rounded-br';
            contentDiv.textContent = content; // User content is plain text
        } else { // Assistant or error
            messageWrapper.classList.add('justify-start');
            contentClasses += ' bg-gray-200 text-gray-800 rounded-bl';
            contentDiv.innerHTML = converter.makeHtml(content); // Assistant content is markdown
        }
        
        contentDiv.className = contentClasses;
        messageWrapper.appendChild(contentDiv);
        chatBox.appendChild(messageWrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function showThinkingIndicator() {
        const messageWrapper = document.createElement('div');
        messageWrapper.className = 'flex justify-start w-full'; // Wrapper for alignment
        messageWrapper.id = 'thinking-indicator'; // Assign an ID to find it later

        const contentDiv = document.createElement('div');
        contentDiv.className = 'p-3 rounded-2xl rounded-bl bg-gray-200 text-gray-800';
        
        contentDiv.innerHTML = `
            <div class="flex items-center gap-2 italic">
                <!-- <div class="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div> -->
                <span>Thinking</span>
                <!-- <div class="w-3 h-3 bg-indigo-500 rounded-full animate-ping"></div> -->
                <div class="flex gap-1">
                    <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
                    <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
                    <div class="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
                </div>
            </div>
        `;
        
        messageWrapper.appendChild(contentDiv);
        chatBox.appendChild(messageWrapper);
        chatBox.scrollTop = chatBox.scrollHeight;
        return messageWrapper; // Return the wrapper element
    }

    function updateThinkingIndicator(indicatorElement, newContent, newRole) {
        let contentClasses = 'p-3 rounded-2xl rounded-bl max-w-[75%] prose';
        if (newRole.includes('error')) {
            contentClasses += ' bg-red-100 text-red-700';
        } else {
            contentClasses += ' bg-gray-200 text-gray-800';
        }

        const contentDiv = indicatorElement.querySelector('div'); // Get the first div inside the wrapper
        contentDiv.className = contentClasses;
        contentDiv.innerHTML = converter.makeHtml(newContent);
    }
});