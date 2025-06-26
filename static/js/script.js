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

    // Initialize Showdown converter
    const converter = new showdown.Converter();

    // Set initial greeting message using the appendMessage function
    appendMessage("Hello! Please upload your PDF documents using the menu on the left and click 'Process' to begin.", 'assistant');


    // Update file name display on file selection
    pdfFilesInput.addEventListener('change', () => {
        if (pdfFilesInput.files.length > 0) {
            const fileNames = Array.from(pdfFilesInput.files).map(f => f.name).join(', ');
            fileNameDisplay.textContent = fileNames;
        } else {
            fileNameDisplay.textContent = 'No files selected';
        }
    });

    // Handle PDF processing with simulated progress bar
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
                showStatus('You can now ask questions below.', 'success');
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

    // Handle sending a chat message with "Thinking" indicator
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
            updateThinkingIndicator(thinkingIndicator, `Sorry, an error occurred: ${error.message}`, 'assistant error');
        } finally {
            enableChat(true);
            userQuestionInput.focus();
        }
    });

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.style.color = type === 'error' ? '#721c24' : (type === 'success' ? '#155724' : 'black');
    }
    
    function enableChat(enabled) {
        userQuestionInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
    }

    function appendMessage(content, role) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Use the converter for assistant messages, otherwise set text content for user messages
        if (role === 'assistant') {
            contentDiv.innerHTML = converter.makeHtml(content);
        } else {
            contentDiv.textContent = content;
        }
        
        messageDiv.appendChild(contentDiv);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function showThinkingIndicator() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = `
            <div class="thinking-indicator">
                <div class="mini-spinner"></div>
                <span>Thinking...</span>
            </div>
        `;
        
        messageDiv.appendChild(contentDiv);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
        return messageDiv;
    }

    function updateThinkingIndicator(indicatorElement, newContent, newRole) {
        indicatorElement.className = `message ${newRole}`;
        const contentDiv = indicatorElement.querySelector('.message-content');
        
        // Convert the new content from Markdown to HTML before inserting
        contentDiv.innerHTML = converter.makeHtml(newContent);
    }
});