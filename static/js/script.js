document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('upload-form');
    const chatForm = document.getElementById('chat-form');
    const pdfFilesInput = document.getElementById('pdf-files');
    const fileNameDisplay = document.getElementById('file-name-display');
    const userQuestionInput = document.getElementById('user-question');
    const chatBox = document.getElementById('chat-box');
    const statusMessage = document.getElementById('status-message');
    const spinner = document.getElementById('spinner');
    const sendBtn = document.getElementById('send-btn');

    let sessionId = null;

    // Update file name display on file selection
    pdfFilesInput.addEventListener('change', () => {
        if (pdfFilesInput.files.length > 0) {
            const fileNames = Array.from(pdfFilesInput.files).map(f => f.name).join(', ');
            fileNameDisplay.textContent = fileNames;
        } else {
            fileNameDisplay.textContent = 'No files selected';
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

        showSpinner(true);
        showStatus('Processing documents...', 'info');

        try {
            const response = await fetch('/process_pdfs', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                sessionId = data.session_id;
                showStatus('Processing complete! You can now ask questions.', 'success');
                enableChat(true);
            } else {
                throw new Error(data.error || 'Failed to process PDFs.');
            }
        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
            enableChat(false);
        } finally {
            showSpinner(false);
        }
    });

    // Handle sending a chat message
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const question = userQuestionInput.value.trim();
        if (!question || !sessionId) {
            return;
        }

        appendMessage(question, 'user');
        userQuestionInput.value = '';
        showSpinner(true);
        sendBtn.disabled = true;

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    user_question: question,
                }),
            });

            const data = await response.json();
            
            if (response.ok) {
                appendMessage(data.answer, 'assistant');
            } else {
                throw new Error(data.error || 'Failed to get a response.');
            }
        } catch (error) {
            appendMessage(`Sorry, an error occurred: ${error.message}`, 'assistant error');
        } finally {
            showSpinner(false);
            sendBtn.disabled = false;
        }
    });

    function showSpinner(show) {
        spinner.style.display = show ? 'flex' : 'none';
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.style.color = type === 'error' ? 'red' : (type === 'success' ? 'green' : 'black');
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
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to the latest message
    }
});