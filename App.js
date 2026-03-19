import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  StatusBar, Vibration, SafeAreaView, Animated,
} from 'react-native';
import * as Speech from 'expo-speech';

// ── MORSE TABLE ──────────────────────────────────────────────────────────────
const MORSE = {
  '.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E',
  '..-.':'F','--.':'G','....':'H','..':'I','.---':'J',
  '-.-':'K','.-..':'L','--':'M','-.':'N','---':'O',
  '.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T',
  '..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y',
  '--..':'Z','.----':'1','..---':'2','...--':'3',
  '....-':'4','.....':'5','-....':'6','--...':'7',
  '---..':'8','----.':'9','-----':'0',
  '.-.-.-':'.','--..--':',','..--..':'?',
  '-..-.':'/','.--.-.':'@','-....-':'-',
};

// ── TIMING ───────────────────────────────────────────────────────────────────
const DASH_THRESH = 300;  // hold longer than this → dash
const CHAR_GAP    = 800;  // pause after release → commit letter
const WORD_GAP    = 2000; // pause after letter → word break
const SPEAK_GAP   = 4500; // pause after word → auto-speak

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [committed, setCommitted]     = useState('');
  const [currentSyms, setCurrentSyms] = useState([]);
  const [status, setStatus]           = useState('READY');
  const [pressing, setPressing]       = useState(false);
  const [speaking, setSpeaking]       = useState(false);
  const [holdPct, setHoldPct]         = useState(0);

  // refs to avoid stale closures in timers
  const committedRef    = useRef('');
  const currentSymsRef  = useRef([]);
  const pressStart      = useRef(0);
  const charTimer       = useRef(null);
  const wordTimer       = useRef(null);
  const speakTimer      = useRef(null);
  const holdAnimFrame   = useRef(null);
  const isPressed       = useRef(false);

  // Animated glow for speaking state
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (speaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
  }, [speaking]);

  // ── helpers ──
  const clearTimers = () => {
    clearTimeout(charTimer.current);
    clearTimeout(wordTimer.current);
    clearTimeout(speakTimer.current);
    cancelAnimationFrame(holdAnimFrame.current);
  };

  const updateCommitted = (text) => {
    committedRef.current = text;
    setCommitted(text);
  };

  const updateCurrentSyms = (syms) => {
    currentSymsRef.current = syms;
    setCurrentSyms([...syms]);
  };

  // ── commit letter ──
  const commitChar = useCallback(() => {
    const syms = currentSymsRef.current;
    if (!syms.length) return;
    const symStr = syms.join('');
    const letter = MORSE[symStr] || '?';
    const newText = committedRef.current + letter;
    updateCommitted(newText);
    updateCurrentSyms([]);
    setStatus('LETTER: ' + letter);

    // auto-speak on sentence-ending punctuation
    if (['.', '?', '!'].includes(letter) && newText.trim().length > 1) {
      clearTimers();
      setTimeout(() => speakSentence(newText.trim()), 400);
    }
  }, []);

  // ── speak ──
  const speakSentence = useCallback((text) => {
    if (!text.trim()) return;
    Speech.stop();
    setSpeaking(true);
    setStatus('SPEAKING…');
    Vibration.vibrate([0, 50, 50, 50]);
    Speech.speak(text, {
      rate: 0.95,
      pitch: 1.0,
      onDone: () => {
        setSpeaking(false);
        setStatus('READY');
        updateCommitted('');
        updateCurrentSyms([]);
      },
      onStopped: () => {
        setSpeaking(false);
        setStatus('READY');
      },
      onError: () => {
        setSpeaking(false);
        setStatus('SPEECH ERROR');
      },
    });
  }, []);

  // ── schedule letter / word / speak timers ──
  const scheduleCommits = useCallback(() => {
    clearTimers();

    charTimer.current = setTimeout(() => {
      commitChar();

      wordTimer.current = setTimeout(() => {
        // word break
        if (
          committedRef.current &&
          committedRef.current[committedRef.current.length - 1] !== ' '
        ) {
          updateCommitted(committedRef.current + ' ');
        }
        setStatus('WORD BREAK');

        // auto-speak after sustained silence
        speakTimer.current = setTimeout(() => {
          const text = committedRef.current.trim();
          if (text) speakSentence(text);
        }, SPEAK_GAP - WORD_GAP);
      }, WORD_GAP - CHAR_GAP);
    }, CHAR_GAP);
  }, [commitChar, speakSentence]);

  // ── add symbol ──
  const addSymbol = useCallback((sym) => {
    const newSyms = [...currentSymsRef.current, sym];
    updateCurrentSyms(newSyms);
    setStatus(sym === '.' ? '· DOT' : '— DASH');
    Vibration.vibrate(sym === '.' ? 40 : 100);
    scheduleCommits();
  }, [scheduleCommits]);

  // ── press in ──
  const onPressIn = useCallback(() => {
    if (isPressed.current) return;
    isPressed.current = true;
    pressStart.current = Date.now();
    setPressing(true);
    setHoldPct(0);
    clearTimers(); // user is still typing — cancel pending commit

    // animate hold progress
    const animate = () => {
      const held = Date.now() - pressStart.current;
      const pct  = Math.min(100, (held / DASH_THRESH) * 100);
      setHoldPct(pct);
      if (isPressed.current) holdAnimFrame.current = requestAnimationFrame(animate);
    };
    holdAnimFrame.current = requestAnimationFrame(animate);
  }, []);

  // ── press out ──
  const onPressOut = useCallback(() => {
    if (!isPressed.current) return;
    isPressed.current = false;
    cancelAnimationFrame(holdAnimFrame.current);

    const held = Date.now() - pressStart.current;
    setPressing(false);
    setHoldPct(0);

    addSymbol(held >= DASH_THRESH ? '-' : '.');
  }, [addSymbol]);

  // ── speak now button ──
  const handleSpeakNow = () => {
    clearTimers();
    if (currentSymsRef.current.length) commitChar();
    setTimeout(() => {
      const text = committedRef.current.trim();
      if (text) speakSentence(text);
    }, 120);
  };

  // ── clear ──
  const handleClear = () => {
    clearTimers();
    Speech.stop();
    updateCommitted('');
    updateCurrentSyms([]);
    setSpeaking(false);
    setPressing(false);
    setHoldPct(0);
    setStatus('CLEARED');
    setTimeout(() => setStatus('READY'), 800);
  };

  const displayText = committed || '_';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080600" />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <Text style={styles.title}>MORSE</Text>
        <Text style={styles.subtitle}>PRESS · PAUSE · SPEAK</Text>
      </View>

      {/* ── DECODED OUTPUT ── */}
      <View style={styles.outputWrap}>
        <Animated.Text
          style={[
            styles.decodedText,
            speaking && { opacity: glowAnim },
          ]}
        >
          {displayText}
        </Animated.Text>

        {/* current letter being built */}
        <View style={styles.currentChar}>
          {currentSyms.map((s, i) =>
            s === '.'
              ? <View key={i} style={styles.dot} />
              : <View key={i} style={styles.dash} />
          )}
        </View>
      </View>

      {/* ── MORSE KEY ── */}
      <View style={styles.keyWrap}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={[styles.keyBtn, pressing && styles.keyBtnPressed]}
          android_disableSound={true}
        >
          {/* hold progress bar */}
          <View style={styles.holdBarTrack}>
            <View style={[styles.holdBarFill, { width: holdPct + '%' }]} />
          </View>
          <Text style={[styles.keyLabel, pressing && styles.keyLabelPressed]}>
            {pressing
              ? holdPct >= 100 ? '— DASH' : '· · ·'
              : 'HOLD = DASH  ·  TAP = DOT'}
          </Text>
        </Pressable>
      </View>

      {/* ── HUD ── */}
      <View style={styles.hud}>

        <Text style={[styles.status, status !== 'READY' && styles.statusActive]}>
          {status}
        </Text>

        <View style={styles.legend}>
          <View style={styles.legItem}>
            <View style={styles.legDot} />
            <Text style={styles.legText}>SHORT PRESS = DOT</Text>
          </View>
          <View style={styles.legItem}>
            <View style={styles.legDash} />
            <Text style={styles.legText}>LONG PRESS = DASH</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleSpeakNow}
          >
            <Text style={styles.actionBtnText}>▶ SPEAK NOW</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            onPress={handleClear}
          >
            <Text style={styles.actionBtnText}>✕ CLEAR</Text>
          </Pressable>
        </View>

      </View>
    </SafeAreaView>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const AMBER     = '#ffb300';
const AMBER_DIM = '#7a5500';
const BG        = '#080600';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: AMBER,
    letterSpacing: 7,
    fontFamily: 'monospace',
  },
  subtitle: {
    fontSize: 10,
    color: AMBER_DIM,
    letterSpacing: 5,
    marginTop: 4,
    fontFamily: 'monospace',
  },

  // output
  outputWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  decodedText: {
    fontSize: 54,
    fontWeight: '700',
    color: AMBER,
    textAlign: 'center',
    letterSpacing: 5,
    lineHeight: 68,
    fontFamily: 'monospace',
  },
  currentChar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    minHeight: 16,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: AMBER,
  },
  dash: {
    width: 30,
    height: 8,
    borderRadius: 4,
    backgroundColor: AMBER,
  },

  // key
  keyWrap: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  keyBtn: {
    height: 88,
    borderWidth: 1,
    borderColor: 'rgba(255,179,0,0.2)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    overflow: 'hidden',
    position: 'relative',
  },
  keyBtnPressed: {
    backgroundColor: 'rgba(255,179,0,0.1)',
    borderColor: AMBER,
  },
  holdBarTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,179,0,0.1)',
  },
  holdBarFill: {
    height: 3,
    backgroundColor: AMBER,
    borderRadius: 2,
  },
  keyLabel: {
    fontSize: 13,
    color: 'rgba(255,179,0,0.3)',
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  keyLabelPressed: {
    color: AMBER,
    fontSize: 16,
    letterSpacing: 3,
  },

  // hud
  hud: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  status: {
    fontSize: 11,
    color: AMBER_DIM,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  statusActive: {
    color: AMBER,
  },
  legend: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 16,
  },
  legItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AMBER,
  },
  legDash: {
    width: 20,
    height: 5,
    borderRadius: 3,
    backgroundColor: AMBER,
  },
  legText: {
    fontSize: 10,
    color: AMBER_DIM,
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: AMBER_DIM,
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnPressed: {
    backgroundColor: 'rgba(255,179,0,0.1)',
    borderColor: AMBER,
  },
  actionBtnText: {
    fontSize: 11,
    color: AMBER_DIM,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
  },
});
