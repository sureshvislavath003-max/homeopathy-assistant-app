import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Sun, Moon, Mic, ChevronRight, Heart, Pill, ShieldOff, Leaf, BookOpen } from 'lucide-react';

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id-for-local';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

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
  const [clarifiedSymptoms, setClarifiedSymptoms] = useState(null);
  const [currentQuestionnaireIndex, setCurrentQuestionnaireIndex] = useState(0);
  const [selectedClarifications, setSelectedClarifications] = useState([]);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

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
            setUserId(crypto.randomUUID());
          }
          setIsAuthReady(true);
        });
      } catch (e) {
        console.error("Firebase authentication error:", e);
        setError("Failed to authenticate with Firebase.");
        setUserId(crypto.randomUUID());
        setIsAuthReady(true);
      }
    };
    if (auth && !isAuthReady) authenticateFirebase();
  }, [auth, initialAuthToken, isAuthReady]);

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
        setError("Could not start voice input.");
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

  const resetApp = () => {
    setSymptomInput('');
    setRemedyData(null);
    setIsLoading(false);
    setIsClarifying(false);
    setClarifiedSymptoms(null);
    setCurrentQuestionnaireIndex(0);
    setSelectedClarifications([]);
    setError(null);
  };

  return (
    <div>
      {/* UI Components go here */}
    </div>
  );
};

export default App;
