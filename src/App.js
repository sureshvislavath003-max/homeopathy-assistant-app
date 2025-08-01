import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Lucide React Icons for a clean look
import { Sun, Moon, Mic, ChevronRight, Heart, Pill, ShieldOff, Leaf, BookOpen } from 'lucide-react';

// Define the Firebase config and app ID from the global variables
// Provide fallback values for local development
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "YOUR_FIREBASE_API_KEY", // Replace with your actual Firebase API Key if you want to use Firebase locally
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id-for-local'; // Fallback for local
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; // Fallback for local

// Initialize Firebase outside the component to avoid re-initialization
let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error("Firebase initialization error:", error);
}

const App = () => {
  const [symptomInput, setSymptomInput] = useState('');
  const [remedyData, setRemedyData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClarifying, setIsClarifying] = useState(false);
  // clarifiedSymptoms will now store an array of objects: [{ category: string, options: string[] }]
  const [clarifiedSymptoms, setClarifiedSymptoms] = useState(null);
  const [currentQuestionnaireIndex, setCurrentQuestionnaireIndex] = useState(0); // Current step in questionnaire
  const [selectedClarifications, setSelectedClarifications] = useState([]); // Stores all selected option strings across steps
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false); // Dark mode state

  // Ref for voice input
  const recognitionRef = useRef(null);
  const inputRef = useRef(null); // Ref for the main symptom input field

  // Authenticate with Firebase on component mount
  useEffect(() => {
    const authenticateFirebase = async () => {
      if (!auth) {
        setError("Firebase Auth not initialized.");
        setIsAuthReady(true);
        return;
      }
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
        onAuthStateChanged(auth, (user) => {
          if (user) {
            setUserId(user.uid);
          } else {
            setUserId(crypto.randomUUID()); // Fallback for unauthenticated
          }
          setIsAuthReady(true);
        });
      } catch (e) {
        console.error("Firebase authentication error:", e);
        setError("Failed to authenticate with Firebase.");
        setUserId(crypto.randomUUID()); // Fallback to a random ID
        setIsAuthReady(true);
      }
    };

    if (auth && !isAuthReady) {
      authenticateFirebase();
    }
  }, [auth, initialAuthToken, isAuthReady]); // Added auth and initialAuthToken as dependencies for useEffect.

  // Handle dark mode class on body
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Initialize SpeechRecognition
  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false; // Only get one result at a time
      recognitionRef.current.interimResults = false; // Don't show interim results

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (inputRef.current) {
          // Determine which input field to update based on context
          if (isClarifying) { // If questionnaire is active, update symptomInput
            setSymptomInput(prev => prev.trim() ? `${prev}, ${transcript}` : transcript);
          } else { // Otherwise, update the main symptom input
            setSymptomInput(transcript);
          }
        }
        setIsLoading(false); // Stop loading indicator after speech input
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setError(`Speech recognition error: ${event.error}`);
        setIsLoading(false);
      };

      recognitionRef.current.onend = () => {
        setIsLoading(false); // Ensure loading is off when recognition ends
      };
    } else {
      console.warn('Speech Recognition not supported in this browser.');
      // Optionally, disable mic button or show a message
    }
  }, [isClarifying]); // Re-initialize if isClarifying changes to correctly target input

  const startVoiceInput = () => {
    if (recognitionRef.current && !isLoading) {
      setError(null);
      setIsLoading(true); // Show loading indicator while listening
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Error starting speech recognition:", e);
        setError("Could not start voice input. Please ensure microphone access is granted.");
        setIsLoading(false);
      }
    }
  };


  // Generic function to call Gemini API with exponential backoff
  const callGeminiApi = async (prompt, isJson, customResponseSchema = null, retries = 0) => {
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = {
      contents: chatHistory,
      generationConfig: isJson ? {
        responseMimeType: "application/json",
        responseSchema: customResponseSchema || { // Default schema for remedies
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

    // YOUR ACTUAL GEMINI API KEY IS NOW HERE
    const apiKey = "AIzaSyC1T68RXnaa55ek6uS-YrF8oRAWB_8QeBI"; 
    // If you are running this in the Canvas environment, the apiKey will be provided automatically.
    // For local development, you MUST replace the placeholder above with your own key.

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const responseText = result.candidates[0].content.parts[0].text;
        return isJson ? JSON.parse(responseText) : responseText;
      } else {
        throw new Error("Invalid response format from API.");
      }
    } catch (e) {
      console.error("API call error:", e);
      if (retries < 3) { // Exponential backoff with max 3 retries
        const delay = Math.pow(2, retries) * 1000; // 1s, 2s, 4s
        await new Promise(res => setTimeout(res, delay)); // Wait for delay
        return callGeminiApi(prompt, isJson, customResponseSchema, retries + 1); // Retry with custom schema
      } else {
        throw new Error("Failed to communicate with the AI. Please try again later.");
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
    setClarifiedSymptoms(null); // Clear clarified symptoms when fetching remedies
    setSelectedClarifications([]); // Clear selections
    setCurrentQuestionnaireIndex(0); // Reset questionnaire index

    const prompt = `As a world-class expert homeopath, provide structured, professional, safe, and clear homeopathic remedy suggestions for the following symptoms/disease: '${symptomInput}'.
    Please provide the output in the following JSON format:
    \`\`\`json
    {
      "remedies": [
        {
          "name": "Bryonia alba",
          "used_for": "Dry cough with chest pain",
          "how_it_works": "Relieves cough by reducing internal dryness and inflammation in the chest lining.",
          "dosage": "30C, twice a day for 5 days",
          "stop_when": "When cough reduces significantly or after 7 days",
          "avoid": "Pregnant women, children under 5 years",
          "side_effects": "Rare nausea or dry mouth",
          "source": "Extracted from the root of the white bryony plant"
        }
      ],
      "lifestyle_tips": [
        "Drink warm water with honey",
        "Avoid cold foods and drinks",
        "Rest the voice if throat is affected"
      ]
    }
    \`\`\`
    Ensure the 'dosage' includes potency, frequency, and duration. 'stop_when' should clearly state when to discontinue. 'avoid' should list who should not use it. 'side_effects' should mention possible side effects. 'source' should state the natural origin. Provide top 3 remedies if possible.`;

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
    setRemedyData(null); // Clear previous remedy data
    setClarifiedSymptoms(null); // Clear previous clarifications
    setSelectedClarifications([]); // Clear selections
    setCurrentQuestionnaireIndex(0); // Reset to the first step

    // Define the schema for the structured clarification response
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

    // Updated prompt to specifically ask for a much more comprehensive questionnaire (20-50 questions)
    const prompt = `As a professional classical homeopath AI assistant, I need to thoroughly understand the user's symptoms or disease: '${symptomInput}'. Please generate a comprehensive questionnaire with multiple categories of clarifying questions. These questions should delve deeply into the **specific characteristics of the current symptoms**, **past medical history (including family history and previous illnesses/treatments related or unrelated to the current issue)**, **mental and emotional state (including temperament, anxieties, fears, mood swings, reactions to stress)**, and **relevant lifestyle factors (e.g., detailed diet preferences/aversions, sleep patterns and quality, energy levels throughout the day, daily habits, reactions to weather/temperature changes, environmental sensitivities, thirst, perspiration, desires, and aversions)**.

    Aim for a total of **20 to 50 specific, distinct questions/statements** across all categories, ensuring each category has a diverse set of 3-7 tickable options that a user can choose from. The questions should be phrased empathetically and professionally, like a homeodoctor conducting a detailed intake.

    Format your response as a JSON array of objects, where each object has a 'category' (the question or general symptom area) and an 'options' array (a list of specific choices).

    Example of desired output structure with more extensive categories and options (for reference, actual content will be dynamic):
    [
      {"category": "Current Symptom - Pain Character", "options": ["Stinging", "Burning", "Throbbing", "Dull ache", "Sharp, cutting", "Pressing", "Tearing", "Sore, bruised", "Cramping"]},
      {"category": "Current Symptom - Modalities (Better/Worse)", "options": ["Worse from cold", "Better from warmth", "Worse from motion", "Better from rest", "Worse at night", "Better in open air", "Worse from touch", "Better from pressure", "Worse after eating"]},
      {"category": "Past Medical History - Childhood Illnesses", "options": ["Frequent colds/flu as child", "Measles", "Mumps", "Chickenpox", "Frequent ear infections", "Chronic tonsillitis"]},
      {"category": "Past Medical History - Adult Illnesses", "options": ["Recurrent infections", "Allergies/Asthma history", "Skin conditions (eczema, psoriasis)", "Digestive disorders (IBS, ulcers)", "Migraines/Headaches", "Joint pain/Arthritis", "Thyroid issues", "Diabetes"]},
      {"category": "Mental/Emotional State - Mood", "options": ["Irritable/Impatient", "Anxious/Fearful", "Sad/Depressed", "Indifferent/Apathetic", "Restless/Agitated", "Overly sensitive", "Easily angered", "Cheerful/Optimistic"]},
      {"category": "Lifestyle - Sleep Patterns", "options": ["Sound and refreshing", "Restless with frequent waking", "Difficulty falling asleep", "Waking too early and cannot return to sleep", "Sleepwalking/talking", "Drowsiness during the day", "Insomnia from thoughts"]},
      {"category": "Lifestyle - Food Preferences/Aversions", "options": ["Craves sweets", "Craves salty foods", "Aversion to meat", "Desires sour foods", "Thirst for cold drinks", "No thirst", "Craves spicy foods", "Aversion to fatty foods", "Desires milk"]},
      {"category": "Lifestyle - Thirst", "options": ["Frequent, large quantities", "Frequent, small sips", "No thirst", "Thirst for cold drinks", "Thirst for warm drinks"]},
      {"category": "Lifestyle - Perspiration", "options": ["Profuse perspiration", "Scanty perspiration", "Perspires easily", "Night sweats", "Perspiration stains yellow"]},
      {"category": "Lifestyle - General Sensitivities", "options": ["Sensitive to noise", "Sensitive to light", "Sensitive to odors", "Sensitive to touch", "Sensitive to pain"]},
      {"category": "Lifestyle - Reactions to Weather", "options": ["Worse in cold, damp weather", "Better in open air", "Worse in stuffy rooms", "Sensitive to drafts", "Worse from heat", "Better from warmth", "Worse before storms"]}
    ]`;

    try {
      const clarificationArray = await callGeminiApi(prompt, true, clarificationSchema);
      setClarifiedSymptoms(clarificationArray);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsClarifying(false);
    }
  };

  // Handler for checkbox changes for the current step
  const handleCheckboxChange = (option) => {
    setSelectedClarifications((prevSelected) =>
      prevSelected.includes(option)
        ? prevSelected.filter((item) => item !== option)
        : [...prevSelected, option]
    );
  };

  // Navigate questionnaire steps
  const handleQuestionnaireNavigation = async () => {
    if (!clarifiedSymptoms) return;

    const currentCategory = clarifiedSymptoms[currentQuestionnaireIndex];
    const selectedOptionsForCurrentStep = currentCategory.options.filter(option => selectedClarifications.includes(option));

    // Append selected options for current step to symptomInput
    const currentInput = symptomInput.trim();
    const newSymptomPart = selectedOptionsForCurrentStep.length > 0 ? selectedOptionsForCurrentStep.join(', ') : '';
    setSymptomInput(currentInput ? `${currentInput}, ${newSymptomPart}` : newSymptomPart);

    // If it's the last step, trigger remedy fetch
    if (currentQuestionnaireIndex === clarifiedSymptoms.length - 1) {
      setClarifiedSymptoms(null); // Hide questionnaire
      setSelectedClarifications([]); // Clear selections
      setCurrentQuestionnaireIndex(0); // Reset index
      await fetchRemedies(); // Fetch remedies with accumulated symptoms
    } else {
      // Move to next step
      setCurrentQuestionnaireIndex(prevIndex => prevIndex + 1);
      // Keep existing selectedClarifications as they are cumulative
    }
  };

  const resetApp = () => {
    setSymptomInput('');
    setRemedyData(null);
    setIsLoading(false);
    setIsClarifying(false);
    setClarifiedSymptoms(null);
    setCurrentQuestionnaireIndex(0);
    setSelectedClarifications([]);
    setError(null);
    // userId and isAuthReady remain
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
