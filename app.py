import os
import uuid
from flask import Flask, request, jsonify, render_template
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
from dotenv import load_dotenv

# --- Initialization and Configuration ---
app = Flask(__name__)
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
gemini_model = os.getenv("GEMINI_MODEL")

# Enhanced in-memory storage to hold full session data
# sessions = { "session_id": { "conversation": chain, "chat_history": [], "file_names": [] } }
sessions = {}

if not api_key:
    # This will raise an error and stop the app if the key is essential for startup.
    # If the app could run without it, a print warning would be sufficient.
    raise ValueError("Google API key not found. Please set the GOOGLE_API_KEY environment variable.")

import google.generativeai as genai
genai.configure(api_key=api_key)


# --- Core Logic Functions ---

def get_pdf_text(pdf_files):
    text = ""
    for pdf_file in pdf_files:
        pdf_reader = PdfReader(pdf_file)
        for page in pdf_reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text
    return text

def get_text_chunks(text):
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=10000, chunk_overlap=1000)
    chunks = text_splitter.split_text(text)
    return chunks

def get_vector_store(text_chunks):
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
    return vector_store

def get_conversational_chain(vector_store):
    llm = ChatGoogleGenerativeAI(model=gemini_model, temperature=0.3)
    memory = ConversationBufferMemory(memory_key='chat_history', return_messages=True, output_key='answer')
    conversation_chain = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=vector_store.as_retriever(),
        memory=memory,
        return_source_documents=False
    )
    return conversation_chain

# --- Frontend Route ---

@app.route('/')
def index():
    return render_template('index.html')


# --- API Endpoints ---

@app.route('/process_pdfs', methods=['POST'])
def process_pdfs():
    if 'pdf_docs' not in request.files:
        return jsonify({"error": "No PDF files provided"}), 400

    pdf_docs = request.files.getlist('pdf_docs')
    if not pdf_docs or pdf_docs[0].filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        file_names = [file.filename for file in pdf_docs]
        raw_text = get_pdf_text(pdf_docs)
        text_chunks = get_text_chunks(raw_text)
        vector_store = get_vector_store(text_chunks)
        conversation_chain = get_conversational_chain(vector_store)
        
        session_id = str(uuid.uuid4())
        
        sessions[session_id] = {
            "conversation": conversation_chain,
            "chat_history": [],
            "file_names": file_names
        }

        return jsonify({
            "message": "PDFs processed successfully.",
            "session_id": session_id,
            "file_names": file_names
        }), 200
    except Exception as e:
        app.logger.error(f"Error processing PDFs: {e}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    session_id = data.get('session_id')
    user_question = data.get('user_question')

    if not session_id or not user_question:
        return jsonify({"error": "Missing 'session_id' or 'user_question'"}), 400
    if session_id not in sessions:
        return jsonify({"error": "Invalid session_id. Please process PDFs first."}), 404

    try:
        session = sessions[session_id]
        conversation = session["conversation"]
        
        response = conversation({'question': user_question})
        
        chat_history = conversation.memory.chat_memory.messages
        
        formatted_history = []
        for msg in chat_history:
            role = "user" if msg.type == "human" else "assistant"
            formatted_history.append({"role": role, "content": msg.content})

        session["chat_history"] = formatted_history

        return jsonify({
            "answer": response.get('answer', 'Sorry, I could not find an answer.'),
            "chat_history": formatted_history
        }), 200
    except Exception as e:
        app.logger.error(f"Error during chat: {e}")
        return jsonify({"error": f"An error occurred during chat: {str(e)}"}), 500

@app.route('/get_session/<session_id>', methods=['GET'])
def get_session(session_id):
    if session_id not in sessions:
        return jsonify({"error": "Session not found"}), 404
    
    session_data = sessions[session_id]
    return jsonify({
        "session_id": session_id,
        "file_names": session_data["file_names"],
        "chat_history": session_data["chat_history"]
    })

# --- Main Execution ---

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)