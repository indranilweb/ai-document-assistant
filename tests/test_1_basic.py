import pypdf # Used for reading and parsing PDF files.
import requests # Used for making HTTP requests (e.g., downloading PDF from URL).
import numpy as np # Used for numerical operations, specifically for calculating cosine similarity between embeddings.
import io # Used for handling byte streams, particularly for PDF content from URL.
import json # Used for JSON serialization and deserialization for API requests/responses.
import os # Used for path validation.

# The API_KEY will be automatically provided by the environment for the specified models.
# As per instructions, leave it as an empty string.
API_KEY = "AIzaSyAburkU174h2nCfBeg0ILJ2S5X3ZWQ6XG0"
# Base URL for the Google Generative Language API.
BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

def get_embedding(text: str) -> list[float]:
    """
    Generates an embedding for the given text using the Gemini embedding model.

    Args:
        text (str): The text to embed.

    Returns:
        list[float]: A list of floats representing the embedding vector.

    Raises:
        requests.exceptions.RequestException: If the API call fails.
        KeyError: If the expected 'embedding' or 'values' key is not found in the response.
    """
    # Construct the URL for the embedding model.
    url = f"{BASE_URL}/embedding-001:embedContent?key={API_KEY}"
    # Prepare the payload for the API request.
    payload = {
        "content": {
            "parts": [{"text": text}]
        }
    }
    headers = {"Content-Type": "application/json"}

    try:
        # Make the POST request to the embedding API.
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()  # Raise an exception for HTTP errors (4xx or 5xx).
        embedding_data = response.json()
        # Extract the embedding values.
        return embedding_data["embedding"]["values"]
    except requests.exceptions.RequestException as e:
        print(f"Error calling embedding API: {e}")
        raise
    except KeyError as e:
        print(f"Unexpected API response structure for embedding: {e}")
        print(f"Response: {embedding_data}")
        raise

def generate_text(prompt: str, history: list = []) -> str:
    """
    Generates text using the Gemini Pro Vision model based on a prompt and chat history.

    Args:
        prompt (str): The current user prompt.
        history (list, optional): A list of previous chat messages to maintain context.
                                 Defaults to [].

    Returns:
        str: The generated text response.

    Raises:
        requests.exceptions.RequestException: If the API call fails.
        KeyError: If the expected response structure is not found.
    """
    # Construct the URL for the text generation model.
    url = f"{BASE_URL}/gemini-2.0-flash:generateContent?key={API_KEY}"
    # Combine existing chat history with the current user prompt.
    contents = history + [{"role": "user", "parts": [{"text": prompt}]}]
    payload = {"contents": contents}
    headers = {"Content-Type": "application/json"}

    try:
        # Make the POST request to the text generation API.
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()  # Raise an exception for HTTP errors.
        data = response.json()

        # Extract the generated text from the response.
        if data.get("candidates") and data["candidates"][0].get("content") and \
           data["candidates"][0]["content"].get("parts") and \
           data["candidates"][0]["content"]["parts"][0].get("text"):
            return data["candidates"][0]["content"]["parts"][0]["text"]
        return "No response generated or an unexpected response format was received."
    except requests.exceptions.RequestException as e:
        print(f"Error calling text generation API: {e}")
        raise
    except KeyError as e:
        print(f"Unexpected API response structure for text generation: {e}")
        print(f"Response: {data}")
        raise

def extract_text_from_pdf_path(pdf_path: str) -> str | None:
    """
    Reads a PDF from a given local file path and extracts all text content from it.

    Args:
        pdf_path (str): The local path to the PDF file.

    Returns:
        str | None: The extracted text as a single string, or None if an error occurs.
    """
    if not os.path.exists(pdf_path):
        print(f"Error: File not found at '{pdf_path}'")
        return None
    if not os.path.isfile(pdf_path):
        print(f"Error: Path '{pdf_path}' is not a file.")
        return None
    if not pdf_path.lower().endswith('.pdf'):
        print(f"Error: File '{pdf_path}' is not a PDF file.")
        return None

    try:
        print(f"Attempting to read PDF from: {pdf_path}")
        with open(pdf_path, 'rb') as pdf_file:
            reader = pypdf.PdfReader(pdf_file)
            text = ""
            # Iterate through each page and extract text.
            for page_num, page in enumerate(reader.pages):
                page_text = page.extract_text()
                if page_text: # Only append if text was successfully extracted
                    text += page_text + "\n"
                else:
                    print(f"Warning: Could not extract text from page {page_num + 1}. Page might be image-based.")
            print("Text extraction complete.")
        return text
    except pypdf.errors.PdfReadError as e:
        print(f"Error reading PDF file '{pdf_path}'. It might be corrupted or encrypted: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred while processing PDF from path: {e}")
        return None

def chunk_text(text: str, chunk_size: int = 1000, overlap_size: int = 200) -> list[str]:
    """
    Splits a long string of text into smaller, overlapping chunks.

    Args:
        text (str): The input text to chunk.
        chunk_size (int): The maximum number of words in each chunk.
        overlap_size (int): The number of words to overlap between consecutive chunks.

    Returns:
        list[str]: A list of text chunks.
    """
    if not text:
        return []

    words = text.split()
    chunks = []
    # Iterate through the words, creating chunks with specified overlap.
    for i in range(0, len(words), chunk_size - overlap_size):
        chunk = words[i:i + chunk_size]
        chunks.append(" ".join(chunk))
    return chunks

def find_similar_chunks(query_embedding: list[float], chunk_embeddings: list[list[float]], top_n: int = 3) -> list[int]:
    """
    Finds the indices of the top_n most similar chunks to a given query embedding
    using cosine similarity.

    Args:
        query_embedding (list[float]): The embedding vector of the query.
        chunk_embeddings (list[list[float]]): A list of embedding vectors for the text chunks.
        top_n (int): The number of top similar chunks to return.

    Returns:
        list[int]: A list of indices of the most similar chunks.
    """
    # Convert lists to numpy arrays for efficient dot product and norm calculations.
    query_vec = np.array(query_embedding)
    chunk_vecs = [np.array(e) for e in chunk_embeddings]

    similarities = []
    # Calculate cosine similarity for each chunk.
    for i, chunk_embed in enumerate(chunk_vecs):
        # Avoid division by zero if an embedding is all zeros.
        if np.linalg.norm(query_vec) == 0 or np.linalg.norm(chunk_embed) == 0:
            similarity = 0.0
        else:
            similarity = np.dot(query_vec, chunk_embed) / (np.linalg.norm(query_vec) * np.linalg.norm(chunk_embed))
        similarities.append((similarity, i))

    # Sort by similarity in descending order and get the top N indices.
    similarities.sort(key=lambda x: x[0], reverse=True)
    return [idx for sim, idx in similarities[:top_n]]

def run_chatbot():
    """
    Main function to run the PDF chatbot application.
    It prompts the user for a PDF file path, processes it, and then enters a chat loop
    to answer questions based on the PDF content.
    """
    print("Welcome to the PDF Chatbot!")
    # Prompt user for PDF file path.
    pdf_path = input("Please provide the local path to your PDF file (e.g., C:/Users/Docs/document.pdf or /home/user/documents/report.pdf): ")

    print("Reading and processing PDF. This may take a moment...")
    pdf_text = extract_text_from_pdf_path(pdf_path)

    if not pdf_text:
        print("Failed to process PDF. Please check the file path and try again. Exiting.")
        return

    print("\nPDF processed successfully. Creating embeddings for text chunks...")
    chunks = chunk_text(pdf_text)
    if not chunks:
        print("No usable content found in PDF after chunking. Exiting.")
        return

    chunk_embeddings = []
    try:
        # Generate embeddings for all chunks.
        for i, chunk in enumerate(chunks):
            print(f"Generating embedding for chunk {i+1}/{len(chunks)}...", end='\r')
            chunk_embeddings.append(get_embedding(chunk))
        print(f"Created embeddings for {len(chunks)} chunks.         ") # Clear the line
    except Exception as e:
        print(f"\nFailed to create embeddings: {e}. Exiting.")
        return

    print("\nChatbot is ready! Ask me questions about the PDF content.")
    print("Type 'exit' to quit.")

    chat_history = []

    while True:
        user_query = input("\nYour question: ")
        if user_query.lower() == 'exit':
            print("Exiting chatbot. Goodbye!")
            break

        try:
            # Generate embedding for the user's question.
            query_embedding = get_embedding(user_query)
            # Find the most relevant chunks from the PDF.
            relevant_chunk_indices = find_similar_chunks(query_embedding, chunk_embeddings, top_n=5)
            # Combine relevant chunks to form the context for the LLM.
            context = "\n".join([chunks[i] for i in relevant_chunk_indices])

            # Construct the prompt for the LLM using the retrieved context.
            prompt = f"""You are a helpful assistant that answers questions based on the provided context.
            If the answer is not present in the context, state clearly that you don't have enough information from the document to answer the question.
            Do not make up information or refer to external knowledge unless explicitly asked.

            Context:
            {context}

            Question: {user_query}
            """
            print("Generating response...")
            # Get response from the Gemini API.
            response = generate_text(prompt, history=chat_history)

            # Update chat history for potential multi-turn conversations.
            chat_history.append({"role": "user", "parts": [{"text": user_query}]})
            chat_history.append({"role": "model", "parts": [{"text": response}]})

            print(f"Answer: {response}")

        except Exception as e:
            print(f"An error occurred while processing your question: {e}")
            print("Please try again.")

# Call the main function to start the chatbot.
run_chatbot()
