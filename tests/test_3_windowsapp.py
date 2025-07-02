import tkinter as tk
from tkinter import filedialog, simpledialog, scrolledtext, messagebox
import threading
import os
from dotenv import load_dotenv
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain.chains.question_answering import load_qa_chain
from langchain.prompts import PromptTemplate
import google.generativeai as genai

# --- BACKEND LOGIC (Mostly Unchanged) ---

def get_pdf_text(pdf_paths):
    """Extracts text from a list of PDF file paths."""
    text = ""
    for pdf_path in pdf_paths:
        pdf_reader = PdfReader(pdf_path)
        for page in pdf_reader.pages:
            text += page.extract_text() or ""
    return text

def get_text_chunks(text):
    """Splits a long string of text into smaller, manageable chunks."""
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=10000, chunk_overlap=1000)
    chunks = text_splitter.split_text(text)
    return chunks

def get_vector_store(text_chunks):
    """Creates and saves a FAISS vector store from a list of text chunks."""
    if not text_chunks:
        return False
    try:
        embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
        vector_store = FAISS.from_texts(text_chunks, embedding=embeddings)
        vector_store.save_local("faiss_index")
        return True
    except Exception as e:
        messagebox.showerror("Embedding Error", f"Could not create embeddings. Check your API key and network connection.\nError: {e}")
        return False

def get_conversational_chain():
    """Creates a question-answering chain with a custom prompt."""
    prompt_template = """
    Answer the question as detailed as possible from the provided context, make sure to provide all the details. If the answer is not in
    the provided context, just say, "The answer is not available in the context." Do not provide a wrong answer.\n\n
    Context:\n {context}?\n
    Question: \n{question}\n

    Answer:
    """
    model = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3)
    prompt = PromptTemplate(template=prompt_template, input_variables=["context", "question"])
    chain = load_qa_chain(model, chain_type="stuff", prompt=prompt)
    return chain

def get_answer(user_question):
    """
    Handles user input, performs a similarity search, and gets the response.
    Returns the answer string.
    """
    try:
        embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
        # allow_dangerous_deserialization is needed for loading FAISS indexes created with older versions.
        db = FAISS.load_local("faiss_index", embeddings, allow_dangerous_deserialization=True)
        docs = db.similarity_search(user_question)
        chain = get_conversational_chain()
        response = chain({"input_documents": docs, "question": user_question}, return_only_outputs=True)
        return response["output_text"]
    except Exception as e:
        return f"An error occurred: {e}"


# --- DESKTOP APPLICATION (Tkinter UI) ---

class ChatbotApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Chat with PDF using Gemini")
        self.geometry("800x600")

        self.pdf_paths = []

        # --- Configure API Key ---
        self.configure_api()

        # --- UI Widgets ---
        self.create_widgets()

    def create_widgets(self):
        # Frame for file selection and processing
        top_frame = tk.Frame(self, pady=10)
        top_frame.pack(fill="x")

        self.select_button = tk.Button(top_frame, text="1. Select PDF(s)", command=self.select_files)
        self.select_button.pack(side="left", padx=10)

        self.process_button = tk.Button(top_frame, text="2. Process PDF(s)", command=self.process_files_thread, state="disabled")
        self.process_button.pack(side="left", padx=10)
        
        self.status_label = tk.Label(top_frame, text="Status: Please select PDF files.")
        self.status_label.pack(side="left", padx=10)

        # Frame for asking questions
        question_frame = tk.Frame(self, pady=10)
        question_frame.pack(fill="x")

        question_label = tk.Label(question_frame, text="Ask a question:")
        question_label.pack(side="left", padx=10)

        self.question_entry = tk.Entry(question_frame, width=70)
        self.question_entry.pack(side="left", fill="x", expand=True, padx=10)
        self.question_entry.bind("<Return>", self.ask_question_thread) # Bind Enter key

        self.ask_button = tk.Button(question_frame, text="Ask", command=self.ask_question_thread, state="disabled")
        self.ask_button.pack(side="left", padx=10)

        # Frame for displaying the answer
        self.answer_text = scrolledtext.ScrolledText(self, wrap=tk.WORD, state="disabled", bg="#f0f0f0")
        self.answer_text.pack(pady=10, padx=10, fill="both", expand=True)

    def configure_api(self):
        load_dotenv()
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            api_key = simpledialog.askstring("API Key Required", "Please enter your Google API Key:", show='*')
            if not api_key:
                messagebox.showerror("Error", "API Key is required to run the application.")
                self.destroy()
                return
        try:
            genai.configure(api_key=api_key)
        except Exception as e:
            messagebox.showerror("API Configuration Error", f"Failed to configure Gemini: {e}")
            self.destroy()

    def select_files(self):
        self.pdf_paths = filedialog.askopenfilenames(
            title="Select PDF Files",
            filetypes=(("PDF files", "*.pdf"), ("All files", "*.*"))
        )
        if self.pdf_paths:
            self.status_label.config(text=f"Status: {len(self.pdf_paths)} file(s) selected.")
            self.process_button.config(state="normal")
        else:
            self.status_label.config(text="Status: No files selected.")
            self.process_button.config(state="disabled")

    def process_files_thread(self):
        # Use a thread to avoid freezing the UI
        self.process_button.config(state="disabled")
        self.select_button.config(state="disabled")
        self.ask_button.config(state="disabled")
        self.status_label.config(text="Status: Processing... This may take a moment.")
        
        processing_thread = threading.Thread(target=self.process_files)
        processing_thread.start()

    def process_files(self):
        raw_text = get_pdf_text(self.pdf_paths)
        if not raw_text.strip():
            self.status_label.config(text="Status: Error - No text could be extracted from the PDF(s).")
            self.select_button.config(state="normal")
            return
            
        text_chunks = get_text_chunks(raw_text)
        
        if get_vector_store(text_chunks):
            self.status_label.config(text="Status: Processing complete. You can now ask questions.")
            self.ask_button.config(state="normal")
        else:
            self.status_label.config(text="Status: Error during processing.")
        
        self.select_button.config(state="normal")
        self.process_button.config(state="normal")

    def ask_question_thread(self, event=None): # event is passed by bind
        user_question = self.question_entry.get()
        if user_question:
            self.ask_button.config(state="disabled")
            self.answer_text.config(state="normal")
            self.answer_text.delete('1.0', tk.END)
            self.answer_text.insert(tk.END, "Thinking...")
            self.answer_text.config(state="disabled")

            answer_thread = threading.Thread(target=self.get_and_display_answer, args=(user_question,))
            answer_thread.start()
            
    def get_and_display_answer(self, question):
        answer = get_answer(question)
        self.answer_text.config(state="normal")
        self.answer_text.delete('1.0', tk.END)
        self.answer_text.insert(tk.END, answer)
        self.answer_text.config(state="disabled")
        self.question_entry.delete(0, tk.END)
        self.ask_button.config(state="normal")


if __name__ == "__main__":
    app = ChatbotApp()
    app.mainloop()