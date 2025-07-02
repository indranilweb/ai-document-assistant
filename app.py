import os
import uuid
import shutil
import json
import time # Import the time module
from flask import Flask, request, jsonify, render_template
from pypdf import PdfReader
import docx # pip install python-docx
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
from dotenv import load_dotenv

# --- Initialization and Configuration ---
app = Flask(__name__, static_url_path='/static', static_folder='static')
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
gemini_model = os.getenv("GEMINI_MODEL")

VECTOR_STORE_DIR = "vector_stores"
os.makedirs(VECTOR_STORE_DIR, exist_ok=True)

sessions = {}

if not api_key:
    raise ValueError("Google API key not found. Please set the GOOGLE_API_KEY environment variable.")

import google.generativeai as genai
genai.configure(api_key=api_key)

# --- Session Repopulation Logic ---
def repopulate_sessions_on_startup():
    """
    Repopulates session data from disk on application startup,
    including file names, chat history, and the new timestamp.
    """
    print("Repopulating sessions from disk...")
    if not os.path.exists(VECTOR_STORE_DIR):
        return
    for session_id in os.listdir(VECTOR_STORE_DIR):
        session_path = os.path.join(VECTOR_STORE_DIR, session_id)
        if os.path.isdir(session_path):
            meta_file_path = os.path.join(session_path, "session_meta.json")
            if os.path.exists(meta_file_path):
                try:
                    with open(meta_file_path, 'r') as f:
                        meta_data = json.load(f)
                        sessions[session_id] = {
                            "chat_history": meta_data.get("chat_history", []),
                            "file_names": meta_data.get("file_names", ["Unknown Files"]),
                            "timestamp": meta_data.get("timestamp", time.time()), # Load timestamp, default to current if not found
                            "conversation": None
                        }
                        print(f"  - Loaded session: {session_id}")
                except (json.JSONDecodeError, IOError) as e:
                    print(f"  - Error loading metadata for session {session_id}: {e}")
    print(f"Total sessions loaded: {len(sessions)}")

# --- Core Logic Functions ---
def get_document_text(files):
    """
    Extracts text from a list of uploaded files (PDF, DOCX, TXT).
    """
    text = ""
    for file in files:
        filename = file.filename
        try:
            text += f"--- {filename} ---\n"
            if filename.endswith('.pdf'):
                pdf_reader = PdfReader(file)
                for page in pdf_reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
            elif filename.endswith('.txt'):
                text += file.read().decode('utf-8') + "\n"
            elif filename.endswith('.docx'):
                document = docx.Document(file)
                for para in document.paragraphs:
                    text += para.text + "\n"
            else:
                print(f"Skipping unsupported file: {filename}")
        except Exception as e:
            print(f"Error processing {filename}: {e}")
    return text

def get_text_chunks(text):
    """
    Splits the raw text into smaller chunks for vector storage.
    """
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=10000, chunk_overlap=1000)
    return text_splitter.split_text(text)

def get_vector_store(text_chunks, session_id):
    """
    Creates a FAISS vector store from text chunks and saves it locally.
    """
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
    vector_store.save_local(os.path.join(VECTOR_STORE_DIR, session_id))
    return vector_store

def get_conversational_chain(vector_store, chat_history):
    """
    Creates and returns a ConversationalRetrievalChain for the chat.
    Initializes memory with existing chat history.
    """
    llm = ChatGoogleGenerativeAI(model=gemini_model, temperature=0.3)
    memory = ConversationBufferMemory(memory_key='chat_history', return_messages=True, output_key='answer')
    for message in chat_history:
        if message['role'] == 'user':
            memory.chat_memory.add_user_message(message['content'])
        elif message['role'] == 'assistant':
            memory.chat_memory.add_ai_message(message['content'])
    return ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=vector_store.as_retriever(),
        memory=memory,
        return_source_documents=False
    )

def get_or_create_conversation(session_id):
    """
    Retrieves an existing conversation chain or creates a new one for a session.
    """
    session_data = sessions.get(session_id)
    if not session_data:
        return None
    if session_data.get("conversation"):
        return session_data["conversation"]

    vector_store_path = os.path.join(VECTOR_STORE_DIR, session_id)
    if not os.path.exists(vector_store_path):
        return None

    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    vector_store = FAISS.load_local(vector_store_path, embeddings, allow_dangerous_deserialization=True)
    conversation_chain = get_conversational_chain(vector_store, session_data.get("chat_history", []))
    sessions[session_id]["conversation"] = conversation_chain
    return conversation_chain

# --- Frontend Route ---
@app.route('/')
def index():
    """Renders the main HTML page."""
    return render_template('index.html')

# --- API Endpoints ---
@app.route('/process_files', methods=['POST'])
def process_files():
    """
    Handles file uploads, extracts text, creates a vector store,
    and initializes a new chat session with a timestamp.
    """
    if 'docs' not in request.files:
        return jsonify({"error": "No files provided"}), 400
    uploaded_files = request.files.getlist('docs')
    if not uploaded_files or uploaded_files[0].filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        session_id = str(uuid.uuid4())
        file_names = [file.filename for file in uploaded_files]
        raw_text = get_document_text(uploaded_files)

        if not raw_text.strip():
            return jsonify({"error": "Could not extract text from the provided documents."}), 400

        text_chunks = get_text_chunks(raw_text)
        get_vector_store(text_chunks, session_id)

        # Initialize session data with current timestamp
        current_timestamp = time.time()
        session_data = {
            "chat_history": [],
            "file_names": file_names,
            "timestamp": current_timestamp,
            "conversation": None
        }
        sessions[session_id] = session_data

        # Save metadata including timestamp
        meta_file_path = os.path.join(VECTOR_STORE_DIR, session_id, "session_meta.json")
        os.makedirs(os.path.dirname(meta_file_path), exist_ok=True) # Ensure directory exists
        with open(meta_file_path, 'w') as f:
            json.dump({
                "chat_history": session_data["chat_history"],
                "file_names": session_data["file_names"],
                "timestamp": session_data["timestamp"] # Save timestamp
            }, f)

        return jsonify({"message": "Files processed successfully.", "session_id": session_id, "file_names": file_names, "timestamp": current_timestamp}), 200
    except Exception as e:
        app.logger.error(f"Error processing files: {e}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handles chat interactions, updates chat history, and saves it
    along with an updated timestamp to session metadata.
    """
    data = request.get_json()
    session_id = data.get('session_id')
    user_question = data.get('user_question')
    if not all([session_id, user_question]):
        return jsonify({"error": "Missing 'session_id' or 'user_question'"}), 400

    conversation = get_or_create_conversation(session_id)
    if not conversation:
        return jsonify({"error": "Session not found or invalid."}), 404

    try:
        response = conversation({'question': user_question})
        chat_history_messages = conversation.memory.chat_memory.messages
        formatted_history = [{"role": "user" if msg.type == "human" else "assistant", "content": msg.content} for msg in chat_history_messages]

        # Update session data with new chat history and current timestamp
        sessions[session_id]["chat_history"] = formatted_history
        sessions[session_id]["timestamp"] = time.time() # Update timestamp on chat activity

        meta_file_path = os.path.join(VECTOR_STORE_DIR, session_id, "session_meta.json")
        with open(meta_file_path, 'w') as f:
            json.dump({
                "chat_history": formatted_history,
                "file_names": sessions[session_id]["file_names"],
                "timestamp": sessions[session_id]["timestamp"] # Save updated timestamp
            }, f)

        return jsonify({"answer": response.get('answer', 'No answer found.'), "chat_history": formatted_history}), 200
    except Exception as e:
        app.logger.error(f"Error during chat: {e}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@app.route('/get_session/<session_id>', methods=['GET'])
def get_session(session_id):
    """
    Retrieves a specific session's data, including its timestamp.
    """
    session_data = sessions.get(session_id)
    if not session_data:
        return jsonify({"error": "Session not found"}), 404
    return jsonify({
        "session_id": session_id,
        "file_names": session_data.get("file_names", []),
        "chat_history": session_data.get("chat_history", []),
        "timestamp": session_data.get("timestamp", time.time()) # Include timestamp
    })

@app.route('/get_all_sessions', methods=['GET'])
def get_all_sessions():
    """
    Returns metadata for all available sessions to populate the frontend list,
    sorted by timestamp (newest first).
    """
    all_sessions_data = []
    for session_id, data in sessions.items():
        all_sessions_data.append({
            "session_id": session_id,
            "file_names": data.get("file_names", ["Unknown Files"]),
            "timestamp": data.get("timestamp", 0) # Include timestamp, default to 0 for old sessions
        })
    
    # Sort sessions by timestamp in descending order (newest first)
    all_sessions_data.sort(key=lambda x: x['timestamp'], reverse=True)
    
    return jsonify(all_sessions_data), 200

@app.route('/delete_session/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """
    Deletes a session's data from memory and disk.
    """
    try:
        if session_id in sessions:
            sessions.pop(session_id)
            print(f"Deleted session {session_id} from memory.")
        session_path = os.path.join(VECTOR_STORE_DIR, session_id)
        if os.path.exists(session_path):
            shutil.rmtree(session_path)
            print(f"Deleted session directory: {session_path}")
        return jsonify({"message": "Session deleted successfully."}), 200
    except Exception as e:
        app.logger.error(f"Error deleting session {session_id}: {e}")
        return jsonify({"error": f"An error occurred during deletion: {str(e)}"}), 500

# --- Main Execution ---
if __name__ == '__main__':
    repopulate_sessions_on_startup()
    app.run(host='0.0.0.0', port=5000, debug=True)
