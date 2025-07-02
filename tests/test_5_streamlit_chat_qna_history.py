# streamlit run app.py

import streamlit as st
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferMemory
from dotenv import load_dotenv
import os

# Load environment variables from a .env file
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
gemini_model = os.getenv("GEMINI_MODEL")

# Ensure the API key is available
if not api_key:
    st.error("Google API key not found. Please set the GOOGLE_API_KEY environment variable.")
    st.stop()

# Configure the Google Generative AI with the API key
import google.generativeai as genai
genai.configure(api_key=api_key)

def get_pdf_text(pdf_docs):
    """
    Extracts text from a list of uploaded PDF documents.

    Args:
        pdf_docs: A list of uploaded PDF files.

    Returns:
        A single string containing the concatenated text from all PDFs.
    """
    text = ""
    for pdf in pdf_docs:
        pdf_reader = PdfReader(pdf)
        for page in pdf_reader.pages:
            # Safely extract text, handling potential None return
            page_text = page.extract_text()
            if page_text:
                text += page_text
    return text

def get_text_chunks(text):
    """
    Splits a long string of text into smaller, manageable chunks.

    Args:
        text: The input text string.

    Returns:
        A list of text chunks.
    """
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=10000, chunk_overlap=1000)
    chunks = text_splitter.split_text(text)
    return chunks

def get_vector_store(text_chunks):
    """
    Creates and returns a FAISS vector store from a list of text chunks.
    This function now returns the vector store instead of saving it locally.

    Args:
        text_chunks: A list of text chunks.
    
    Returns:
        A FAISS vector store object.
    """
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
    return vector_store

def get_conversational_chain(vector_store):
    """
    Creates a conversational retrieval chain with memory.
    This is a new function that replaces the old one.

    Args:
        vector_store: A FAISS vector store containing the document embeddings.

    Returns:
        A LangChain conversational retrieval chain.
    """
    # Define the language model
    llm = ChatGoogleGenerativeAI(model=gemini_model, temperature=0.3)
    
    # Create a memory object to store the conversation history
    memory = ConversationBufferMemory(
        memory_key='chat_history', 
        return_messages=True
    )
    
    # Create the conversational retrieval chain
    conversation_chain = ConversationalRetrievalChain.from_llm(
        llm=llm,
        retriever=vector_store.as_retriever(),
        memory=memory
    )
    return conversation_chain

def handle_user_input(user_question):
    """
    Handles user input by calling the conversational chain and updating the chat history.
    This function replaces the old `user_input` function.

    Args:
        user_question: The question asked by the user.
    """
    # Check if the conversation chain is initialized
    if st.session_state.conversation is None:
        st.warning("Please process your documents first.")
        return

    # Call the chain with the user's question, which automatically uses the stored history
    response = st.session_state.conversation({'question': user_question})
    
    # Update the chat history in the session state
    st.session_state.chat_history = response['chat_history']

    # We will display the conversation in the main function body
    # so the UI updates correctly after each message.

def main():
    """
    The main function to run the Streamlit application.
    """
    st.set_page_config(page_title="Chat with Multiple PDFs", page_icon="💬")
    st.header("Chat with your PDFs using Gemini 💬")

    # --- Session State Initialization ---
    # This is crucial for maintaining state across reruns
    if "conversation" not in st.session_state:
        st.session_state.conversation = None
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []
    if "vector_store" not in st.session_state:
        st.session_state.vector_store = None

    # --- Sidebar for Document Upload and Processing ---
    with st.sidebar:
        st.title("Menu")
        pdf_docs = st.file_uploader("Upload your PDF Files and Click 'Process'", accept_multiple_files=True)
        if st.button("Process"):
            if pdf_docs:
                with st.spinner("Processing documents..."):
                    # 1. Extract raw text from PDFs
                    raw_text = get_pdf_text(pdf_docs)
                    
                    # 2. Split text into chunks
                    text_chunks = get_text_chunks(raw_text)
                    
                    # 3. Create vector store from chunks
                    st.session_state.vector_store = get_vector_store(text_chunks)
                    
                    # 4. Create conversational chain and store in session state
                    st.session_state.conversation = get_conversational_chain(st.session_state.vector_store)
                    
                    st.success("Processing Complete!")
            else:
                st.warning("Please upload at least one PDF file.")

    # --- Main Chat Interface ---
    st.write("Welcome! Ask any question about the content of your documents.")

    # Display chat history
    if st.session_state.chat_history:
        for i, message in enumerate(st.session_state.chat_history):
            # User messages are at even indices, bot messages at odd indices
            if i % 2 == 0:
                with st.chat_message("user"):
                    st.markdown(message.content)
            else:
                with st.chat_message("assistant"):
                    st.markdown(message.content)

    # Chat input for the user
    user_question = st.chat_input("Ask a question about your documents:")

    if user_question:
        handle_user_input(user_question)
        # Rerun the app to display the latest message immediately
        st.rerun()

if __name__ == "__main__":
    main()
