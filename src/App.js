import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // Removed signInWithCustomToken as it's not used
import { getFirestore } from 'firebase/firestore';
// Lucide React Icons for a clean look
import { Sun, Moon, Mic, ChevronRight, Heart, Pill, ShieldOff, Leaf, BookOpen } from 'lucide-react'; // RotateCcw is used for the reset button
// --- Firebase Configuration for Netlify Compatibility ---
// These values are now directly defined or set to null/default,
// completely removing reliance on Canvas-specific global variables.
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY", // IMPORTANT: If you want Firebase to work locally, replace this with YOUR actual Firebase API Key
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN", // Replace with your actual Firebase Auth Domain
  projectId: "YOUR_FIREBASE_PROJECT_ID",   // Replace with your actual Firebase Project ID
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
// initialAuthToken and defaultAppId removed as they are not used in this simplified auth setup
// const initialAuthToken = null;
// const defaultAppId = 'netlify-app';

// Initialize Firebase outside the component to avoid re-initialization
let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app); // db is initialized but not directly used for data operations in this version, which ESLint might flag.
                          // For this context, it's okay as it doesn't cause a build failure.
} catch (error) {
  // Log Firebase initialization error, but don't stop the app if it's just local testing without full setup
  console.error("Firebase initialization error:", error);
}

const App = () => {
  const [symptomInput, setSymptomInput] = useState('');
  const [remedyData, setRemedyData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarifiedSymptoms, setClarifiedSymptoms] = useState(null);
  const [currentQuestionnaireIndex, setCurrentQuestionnaireIndex] = useState(0);
  const [selectedClarifications, setSelectedClarifications] = useState([]);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false); // Indicates if user ID is ready
  const [darkMode, setDarkMode] = useState(false);

  // Ref for voice input
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  // --- User ID Setup for Netlify Compatibility ---
  // This now always attempts anonymous sign-in or generates a local UUID.
  useEffect(() => {
    const setupUserId = async () => {
      if (auth) { // Only try Firebase auth if it initialized successfully
        try {
          // Attempt anonymous sign-in
          await signInAnonymously(auth);
          onAuthStateChanged(auth, (user) => {
            if (user) {
              setUserId(user.uid);
            } else {
              setUserId(crypto.randomUUID()); // Fallback if auth state changes unexpectedly
            }
            setIsAuthReady(true);
          });
        } catch (e) {
          console.error("Firebase anonymous sign-in error:", e);
          setError("Failed to initialize user session. Using local ID.");
          setUserId(crypto.randomUUID()); // Fallback to a random ID if Firebase auth fails
          setIsAuthReady(true);
        }
      } else { // If Firebase auth didn't initialize, just generate a local UUID
        setUserId(crypto.randomUUID());
        setIsAuthReady(true);
      }
    };

    // This useEffect should only run once on mount.
    // The dependency array is correct: it depends on 'auth' (its initial value) and 'isAuthReady' to prevent re-runs.
    if (!isAuthReady) { // Only run if not already ready
      setupUserId();
    }
  }, [auth, isAuthReady]); // 'auth' is a dependency because its initial value determines the path; 'isAuthReady' prevents infinite loop


  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (inputRef.current) {
          setSymptomInput(prev => isClarifying && prev.trim() ? `${prev}, ${transcript}` : transcript);
        }
        setIsLoading(false);
      };
      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setError(`Speech recognition error: ${event.error}`);
        setIsLoading(false);
      };
      recognitionRef.current.onend = () => {
        setIsLoading(false);
      };
    } else {
      console.warn('Speech Recognition not supported in this browser.');
    }
  }, [isClarifying]);

  const startVoiceInput = () => {
    if (recognitionRef.current && !isLoading) {
      setError(null);
      setIsLoading(true);
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Error starting speech recognition:", e);
        setError("Could not start voice input. Please ensure microphone access is granted.");
        setIsLoading(false);
      }
    }
  };

  const callGeminiApi = async (prompt, isJson, customResponseSchema = null, retries = 0) => {
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = {
      contents: chatHistory,
      generationConfig: isJson ? {
        responseMimeType: "application/json",
        responseSchema: customResponseSchema || {
          type: "OBJECT",
          properties: {
            remedies: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  used_for: { type: "STRING" },
                  how_it_works: { type: "STRING" },
                  dosage: { type: "STRING" },
                  stop_when: { type: "STRING" },
                  avoid: { type: "STRING" },
                  side_effects: { type: "STRING" },
                  source: { type: "STRING" },
                },
                required: ["name", "used_for", "how_it_works", "dosage", "stop_when", "avoid", "side_effects", "source"],
              },
            },
            lifestyle_tips: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
          required: ["remedies"],
        },
      } : {},
    };

    const apiKey = "AIzaSyC1T68RXnaa55ek6uS-YrF8oRAWB_8QeBI"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();

      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        return isJson ? JSON.parse(result.candidates[0].content.parts[0].text) : result.candidates[0].content.parts[0].text;
      } else {
        throw new Error("Invalid response format from API.");
      }
    } catch (e) {
      console.error("API call error:", e);
      if (retries < 3) {
        const delay = Math.pow(2, retries) * 1000;
        await new Promise(res => setTimeout(res, delay));
        return callGeminiApi(prompt, isJson, customResponseSchema, retries + 1);
      } else {
        throw new Error("Failed to communicate with the AI.");
      }
    }
  };

  const fetchRemedies = async () => {
    if (!symptomInput.trim()) {
      setError("Please enter symptoms or a disease name.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setRemedyData(null);
    setClarifiedSymptoms(null);
    setSelectedClarifications([]);
    setCurrentQuestionnaireIndex(0);

    const prompt = `As a world-class expert homeopath, provide structured, professional, safe, and clear homeopathic remedy suggestions for the following symptoms/disease: '${symptomInput}'. Please provide the output in a JSON format with remedies and lifestyle_tips.`;

    try {
      const parsedJson = await callGeminiApi(prompt, true);
      setRemedyData(parsedJson);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const clarifySymptoms = async () => {
    if (!symptomInput.trim()) {
      setError("Please enter symptoms or a disease name to clarify.");
      return;
    }

    setIsClarifying(true);
    setError(null);
    setRemedyData(null);
    setClarifiedSymptoms(null);
    setSelectedClarifications([]);
    setCurrentQuestionnaireIndex(0);

    const clarificationSchema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          options: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["category", "options"]
      }
    };

    const prompt = `Generate a comprehensive homeopathic symptom questionnaire for '${symptomInput}' with categories and tickable options.`;

    try {
      const clarificationArray = await callGeminiApi(prompt, true, clarificationSchema);
      setClarifiedSymptoms(clarificationArray);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsClarifying(false);
    }
  };

  const handleCheckboxChange = (option) => {
    setSelectedClarifications((prev) =>
      prev.includes(option) ? prev.filter(item => item !== option) : [...prev, option]
    );
  };

  const handleQuestionnaireNavigation = async () => {
    if (!clarifiedSymptoms) return;
    const currentCategory = clarifiedSymptoms[currentQuestionnaireIndex];
    const selectedOptionsForCurrentStep = currentCategory.options.filter(option => selectedClarifications.includes(option));
    const currentInput = symptomInput.trim();
    const newSymptomPart = selectedOptionsForCurrentStep.join(', ');
    setSymptomInput(currentInput ? `${currentInput}, ${newSymptomPart}` : newSymptomPart);

    if (currentQuestionnaireIndex === clarifiedSymptoms.length - 1) {
      setClarifiedSymptoms(null);
      setSelectedClarifications([]);
      setCurrentQuestionnaireIndex(0);
      await fetchRemedies();
    } else {
      setCurrentQuestionnaireIndex(prev => prev + 1);
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gradient-to-br from-green-50 to-blue-100 text-gray-800'} p-4 sm:p-6 lg:p-8 flex flex-col items-center font-inter transition-colors duration-300`}>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet" />

      <div className={`w-full max-w-3xl ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-lg p-6 sm:p-8 lg:p-10 mb-8 transition-colors duration-300`}>
        <div className="flex justify-between items-center mb-6">
          <h1 className={`text-3xl sm:text-4xl font-bold ${darkMode ? 'text-green-300' : 'text-green-700'} text-center flex-grow`}>
            Homeopathy Assistant
          </h1>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 text-yellow-300' : 'bg-gray-200 text-gray-700'} hover:scale-105 transition-transform duration-200`}
              aria-label={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>

        <p className={`text-center ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-8`}>
          Enter your symptoms or a disease name to get personalized homeopathic remedy suggestions.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-grow">
            <input
              ref={inputRef} // Attach ref for voice input
              type="text"
              value={symptomInput}
              onChange={(e) => {
                setSymptomInput(e.target.value);
                setClarifiedSymptoms(null); // Clear clarification when input changes
                setSelectedClarifications([]); // Clear selections when input changes
                setCurrentQuestionnaireIndex(0); // Reset questionnaire index
              }}
              placeholder="e.g., dry cough with chest pain, fever, anxiety"
              className={`w-full p-3 pr-10 border ${darkMode ? 'border-gray-600 bg-gray-700 text-gray-100' : 'border-gray-300 bg-white text-gray-700'} rounded-lg focus:outline-none focus:ring-2 ${darkMode ? 'focus:ring-green-400' : 'focus:ring-blue-400'}`}
              disabled={isLoading || !isAuthReady}
            />
            <button
              onClick={startVoiceInput}
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full ${darkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-500 hover:bg-gray-100'} transition-colors duration-200`}
              aria-label="Voice Input"
              disabled={isLoading || !isAuthReady || !recognitionRef.current}
            >
              <Mic size={20} />
            </button>
          </div>
          <button
            onClick={fetchRemedies}
            disabled={isLoading || !isAuthReady || isClarifying}
            className={`px-6 py-3 ${darkMode ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'} text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isLoading && !isClarifying ? 'Searching...' : 'Get Remedies Directly'}
          </button>
          <button
            onClick={clarifySymptoms}
            disabled={isClarifying || !isAuthReady || isLoading}
            className={`px-6 py-3 ${darkMode ? 'bg-teal-600 hover:bg-teal-700 focus:ring-teal-500' : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'} text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isClarifying ? 'Clarifying...' : '✨ Clarify Symptoms'}
          </button>
        </div>

        {error && (
          <div className={`${darkMode ? 'bg-red-800 text-red-200' : 'bg-red-100 border border-red-400 text-red-700'} px-4 py-3 rounded-lg relative mb-6`} role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {userId && (
          <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} text-center mb-4`}>
            User ID: {userId}
          </div>
        )}
      </div>

      {clarifiedSymptoms && (
        <div className={`w-full max-w-3xl ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-lg p-6 sm:p-8 lg:p-10 mb-8 transition-colors duration-300`}>
          <h2 className={`text-2xl sm:text-3xl font-bold ${darkMode ? 'text-green-300' : 'text-gray-800'} mb-4 text-center`}>
            Symptom Clarification
          </h2>
          <p className={`text-sm italic ${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-4 text-center`}>
            Select relevant options to refine your symptom input.
          </p>
          <div className="space-y-4">
            {clarifiedSymptoms[currentQuestionnaireIndex] && (
              <div className={`border ${darkMode ? 'border-gray-700' : 'border-gray-200'} rounded-lg p-4 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <h3 className={`text-lg font-semibold ${darkMode ? 'text-green-200' : 'text-gray-800'} mb-3`}>
                  {currentQuestionnaireIndex + 1}. {clarifiedSymptoms[currentQuestionnaireIndex].category}
                </h3>
                <div className="space-y-2">
                  {clarifiedSymptoms[currentQuestionnaireIndex].options.map((option, optIndex) => (
                    <label key={optIndex} className={`flex items-center space-x-3 cursor-pointer p-2 rounded-md ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-100'} transition-colors duration-200`}>
                      <input
                        type="checkbox"
                        checked={selectedClarifications.includes(option)}
                        onChange={() => handleCheckboxChange(option)}
                        className={`form-checkbox h-5 w-5 ${darkMode ? 'text-green-500 focus:ring-green-400' : 'text-blue-600 focus:ring-blue-500'} rounded`}
                      />
                      <span className={`${darkMode ? 'text-gray-100' : 'text-gray-800'} text-base`}>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleQuestionnaireNavigation}
            className={`mt-6 w-full px-6 py-3 ${darkMode ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500' : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'} text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed`}
            disabled={isLoading}
          >
            {currentQuestionnaireIndex === clarifiedSymptoms.length - 1 ? 'Add Selected to Symptoms and Get Remedies' : 'Next Step'}
            <ChevronRight size={20} className="inline-block ml-2" />
          </button>
        </div>
      )}

      {remedyData && remedyData.remedies && remedyData.remedies.length > 0 && (
        <div className={`w-full max-w-3xl ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-xl shadow-lg p-6 sm:p-8 lg:p-10 transition-colors duration-300`}>
          <h2 className={`text-2xl sm:text-3xl font-bold ${darkMode ? 'text-green-300' : 'text-gray-800'} mb-6 text-center`}>
            Suggested Remedies
          </h2>
          {remedyData.remedies.map((remedy, index) => (
            <div key={index} className={`border ${darkMode ? 'border-gray-700' : 'border-gray-200'} rounded-lg p-5 mb-6 last:mb-0 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
              <h3 className={`text-xl font-semibold ${darkMode ? 'text-blue-300' : 'text-blue-700'} mb-3 flex items-center`}>
                <Heart size={24} className="mr-2 text-red-500" /> ✅ {remedy.name}
              </h3>
              <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-2`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Treats:</strong> {remedy.used_for}</p>
              <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-4`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>How it works:</strong> {remedy.how_it_works}</p>

              <div className={`border-t ${darkMode ? 'border-gray-600' : 'border-gray-200'} pt-4 mt-4`}>
                <h4 className={`text-lg font-semibold ${darkMode ? 'text-green-200' : 'text-gray-800'} mb-2 flex items-center`}>
                  <Pill size={20} className="mr-2 text-yellow-500" /> Dosage and Potency
                </h4>
                <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-2`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Recommended:</strong> {remedy.dosage}</p>
                <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-2`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Stop when:</strong> {remedy.stop_when}</p>
              </div>

              <div className={`border-t ${darkMode ? 'border-gray-600' : 'border-gray-200'} pt-4 mt-4`}>
                <h4 className={`text-lg font-semibold ${darkMode ? 'text-green-200' : 'text-gray-800'} mb-2 flex items-center`}>
                  <ShieldOff size={20} className="mr-2 text-orange-500" /> When to Avoid This Remedy
                </h4>
                <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-2`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Avoid if:</strong> {remedy.avoid}</p>
                <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'} mb-2`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Possible side effects:</strong> {remedy.side_effects}</p>
                <p className={`${darkMode ? 'text-gray-400' : 'text-gray-700'} text-sm italic mt-2`}>Always consult a qualified healthcare professional if symptoms persist or worsen, or before starting any new treatment, especially if you have underlying health conditions or are on other medications.</p>
              </div>

              <div className={`border-t ${darkMode ? 'border-gray-600' : 'border-gray-200'} pt-4 mt-4`}>
                <h4 className={`text-lg font-semibold ${darkMode ? 'text-green-200' : 'text-gray-800'} mb-2 flex items-center`}>
                  <Leaf size={20} className="mr-2 text-green-500" /> Remedy Source
                </h4>
                <p className={`${darkMode ? 'text-gray-200' : 'text-gray-700'}`}><strong className={`${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>Origin:</strong> {remedy.source}</p>
              </div>
            </div>
          ))}

          {remedyData.lifestyle_tips && remedyData.lifestyle_tips.length > 0 && (
            <div className={`border ${darkMode ? 'border-gray-700' : 'border-gray-200'} rounded-lg p-5 mt-6 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
              <h3 className={`text-xl font-semibold ${darkMode ? 'text-green-200' : 'text-gray-800'} mb-3 flex items-center`}>
                <BookOpen size={20} className="mr-2 text-blue-500" /> General Lifestyle Tips
              </h3>
              <ul className={`list-disc list-inside ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                {remedyData.lifestyle_tips.map((tip, index) => (
                  <li key={index} className="mb-1">{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
