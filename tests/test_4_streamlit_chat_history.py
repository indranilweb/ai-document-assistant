# streamlit run app.py

import streamlit as st
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain.chains.question_answering import load_qa_chain
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
import os

# Load environment variables from a .env file
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
gemini_model = os.getenv("GEMINI_MODEL")

# Check for API key and stop if not found
if not api_key:
    st.error("Google API key not found. Please set the GOOGLE_API_KEY environment variable.")
    st.stop()

# Configure the Generative AI model
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
    Creates and saves a FAISS vector store from a list of text chunks.
    This function will be called only when new PDFs are uploaded.

    Args:
        text_chunks: A list of text chunks.
    """
    try:
        embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
        vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
        # Save the vector store to session state instead of a local file
        st.session_state.vector_store = vector_store
        st.success("Vector store created successfully!")
    except Exception as e:
        st.error(f"Error creating vector store: {e}")


def get_conversational_chain():
    """
    Creates a question-answering chain with a custom prompt that includes chat history.

    Returns:
        A LangChain conversational chain.
    """
    # Updated prompt template to include chat_history
    prompt_template = """
    You are a helpful assistant. Answer the question as detailed as possible from the provided context and conversation history.
    Make sure to provide all the details. If the answer is not in the provided context, just say,
    "The answer is not available in the provided documents." Do not provide a wrong answer.

    Context:\n {context}\n
    Chat History:\n {chat_history}\n
    Question: \n{question}\n

    Answer:
    """

    model = ChatGoogleGenerativeAI(model=gemini_model, temperature=0.3)

    # Update prompt to accept context, chat_history, and question
    prompt = PromptTemplate(template=prompt_template, input_variables=["context", "chat_history", "question"])
    chain = load_qa_chain(model, chain_type="stuff", prompt=prompt)
    return chain

def handle_user_input(user_question):
    """
    Handles user input, performs a similarity search, and gets the response.
    This function now uses the vector store from session state and includes chat history.

    Args:
        user_question: The question asked by the user.
    """
    # Check if the vector store is available in the session state
    if "vector_store" not in st.session_state or st.session_state.vector_store is None:
        st.warning("Please submit and process your PDF files first.")
        return

    # Use the vector store from session state
    vector_store = st.session_state.vector_store
    docs = vector_store.similarity_search(user_question)

    chain = get_conversational_chain()

    # Format the chat history for the prompt
    chat_history_str = "\n".join([f"{msg['role']}: {msg['content']}" for msg in st.session_state.messages])

    # Run the chain with the necessary inputs
    response = chain(
        {"input_documents": docs, "chat_history": chat_history_str, "question": user_question},
        return_only_outputs=True
    )

    # Add the assistant's response to the chat history
    st.session_state.messages.append({"role": "assistant", "content": response["output_text"]})
    
    # Display the latest assistant message
    with st.chat_message("assistant"):
        st.markdown(response["output_text"])


def main():
    """
    The main function to run the Streamlit application.
    """
    st.set_page_config(page_title="Chat with Multiple PDFs", page_icon="💬")
    st.header("Chat with PDF using Gemini 💬")

    # Initialize session state for messages if it doesn't exist
    if "messages" not in st.session_state:
        st.session_state.messages = [{"role": "assistant", "content": "Hello! Upload your PDFs and I can answer questions about them."}]

    # Initialize session state for vector store
    if "vector_store" not in st.session_state:
        st.session_state.vector_store = None

    # Sidebar for PDF uploads
    with st.sidebar:
        st.title("Menu")
        st.write("Upload your PDF files and click 'Submit & Process' to start.")
        pdf_docs = st.file_uploader("Upload PDF Files", accept_multiple_files=True, type="pdf")
        if st.button("Submit & Process"):
            if pdf_docs:
                with st.spinner("Processing PDFs..."):
                    # Get text from all PDFs
                    raw_text = get_pdf_text(pdf_docs)
                    if not raw_text.strip():
                        st.warning("Could not extract text from the PDFs. Please try other files.")
                    else:
                        # Get text chunks
                        text_chunks = get_text_chunks(raw_text)
                        
                        # Create and store vector store in session state
                        get_vector_store(text_chunks)
                        
                        # Clear previous chat history on new document submission
                        st.session_state.messages = [{"role": "assistant", "content": "Processing complete! How can I help you with your documents?"}]

            else:
                st.warning("Please upload at least one PDF file.")

    # Display chat messages from history on app rerun
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    # Accept user input using chat_input
    if user_question := st.chat_input("Ask a question about your documents..."):
        # Add user question to chat history
        st.session_state.messages.append({"role": "user", "content": user_question})
        # Display user message in chat message container
        with st.chat_message("user"):
            st.markdown(user_question)
        
        # Handle the user's input and generate a response
        handle_user_input(user_question)

if __name__ == "__main__":
    main()
