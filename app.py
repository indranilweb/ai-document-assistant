import os
import uuid
from flask import Flask, request, jsonify, render_template # <-- Import render_template
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

# In-memory storage for vector stores and conversation chains
vector_stores = {}
conversations = {}

if not api_key:
    raise ValueError("Google API key not found. Please set the GOOGLE_API_KEY environment variable.")

import google.generativeai as genai
genai.configure(api_key=api_key)


# --- Core Logic Functions (remain unchanged) ---

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
    print("Creating vector store with embeddings...")
    print(embeddings)
    vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
    print(vector_store)
    return vector_store

def get_conversational_chain(vector_store):
    llm = ChatGoogleGenerativeAI(model=gemini_model, temperature=0.3)
    memory = ConversationBufferMemory(memory_key='chat_history', return_messages=True)
    conversation_chain = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=vector_store.as_retriever(),
        memory=memory
    )
    return conversation_chain

# --- Frontend Route ---

@app.route('/')
def index():
    """
    Renders the main frontend page.
    """
    return render_template('index.html')


# --- API Endpoints (remain unchanged) ---

@app.route('/process_pdfs', methods=['POST'])
def process_pdfs():
    if 'pdf_docs' not in request.files:
        return jsonify({"error": "No PDF files provided"}), 400
    pdf_docs = request.files.getlist('pdf_docs')
    if not pdf_docs or pdf_docs[0].filename == '':
        return jsonify({"error": "No selected file"}), 400
    try:
        raw_text = get_pdf_text(pdf_docs)
        text_chunks = get_text_chunks(raw_text)
        vector_store = get_vector_store(text_chunks)
        session_id = str(uuid.uuid4())
        vector_stores[session_id] = vector_store
        conversations[session_id] = get_conversational_chain(vector_store)
        print(f"\nconversations: {conversations}\n")  # Debugging line
        print(f"\nvector_stores: {vector_stores}\n")  # Debugging line
        return jsonify({
            "message": "PDFs processed successfully.",
            "session_id": session_id
        }), 200
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    session_id = data.get('session_id')
    user_question = data.get('user_question')
    if not session_id or not user_question:
        return jsonify({"error": "Missing 'session_id' or 'user_question'"}), 400
    if session_id not in conversations:
        return jsonify({"error": "Invalid 'session_id'. Please process PDFs first."}), 404
    try:
        conversation = conversations[session_id]
        response = conversation({'question': user_question})
        formatted_history = []
        print("Response from conversation:", response)  # Debugging line
        for i, message in enumerate(response['chat_history']):
            role = "user" if i % 2 == 0 else "assistant"
            formatted_history.append({"role": role, "content": message.content})
        return jsonify({
            "answer": response['answer'],
            "chat_history": formatted_history
        }), 200
    except Exception as e:
        return jsonify({"error": f"An error occurred during chat: {str(e)}"}), 500

# --- Main Execution ---

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)