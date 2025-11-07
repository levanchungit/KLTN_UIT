// components/AIBotIcon.tsx
import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

export default function AIBotIcon({ size = 40 }: { size?: number }) {
  // Animation values
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Sparkle animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(sparkleAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Rotate animation
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const sparkleOpacity = sparkleAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.5, 1, 0.5],
  });

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [{ scale: pulseAnim }],
      }}
    >
      {/* Background rotating gradient glow */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          transform: [{ rotate: rotateInterpolate }],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Defs>
            <LinearGradient
              id="glowGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <Stop offset="0%" stopColor="#4285F4" stopOpacity="0.3" />
              <Stop offset="50%" stopColor="#EA4335" stopOpacity="0.3" />
              <Stop offset="100%" stopColor="#FBBC04" stopOpacity="0.3" />
            </LinearGradient>
          </Defs>
          <Circle cx="24" cy="24" r="22" fill="url(#glowGradient)" />
        </Svg>
      </Animated.View>

      {/* Main Gemini-style star icon */}
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          {/* Blue gradient */}
          <LinearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#4285F4" stopOpacity="1" />
            <Stop offset="100%" stopColor="#1967D2" stopOpacity="1" />
          </LinearGradient>
          {/* Red gradient */}
          <LinearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#EA4335" stopOpacity="1" />
            <Stop offset="100%" stopColor="#C5221F" stopOpacity="1" />
          </LinearGradient>
          {/* Yellow gradient */}
          <LinearGradient id="yellowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FBBC04" stopOpacity="1" />
            <Stop offset="100%" stopColor="#F9AB00" stopOpacity="1" />
          </LinearGradient>
          {/* Green gradient */}
          <LinearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#34A853" stopOpacity="1" />
            <Stop offset="100%" stopColor="#0F9D58" stopOpacity="1" />
          </LinearGradient>
        </Defs>

        {/* Gemini star shape - 4 pointed star with Google colors */}
        {/* Top point - Blue */}
        <Path d="M 24 6 L 28 20 L 24 22 L 20 20 Z" fill="url(#blueGrad)" />

        {/* Right point - Red */}
        <Path d="M 42 24 L 28 28 L 26 24 L 28 20 Z" fill="url(#redGrad)" />

        {/* Bottom point - Yellow */}
        <Path d="M 24 42 L 20 28 L 24 26 L 28 28 Z" fill="url(#yellowGrad)" />

        {/* Left point - Green */}
        <Path d="M 6 24 L 20 20 L 22 24 L 20 28 Z" fill="url(#greenGrad)" />

        {/* Center star core - bright gradient */}
        <Path
          d="M 24 18 L 26 22 L 30 24 L 26 26 L 24 30 L 22 26 L 18 24 L 22 22 Z"
          fill="#FFFFFF"
          opacity="0.95"
        />

        {/* Inner accent */}
        <Circle cx="24" cy="24" r="3" fill="url(#blueGrad)" opacity="0.8" />
      </Svg>

      {/* Animated sparkles */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          opacity: sparkleOpacity,
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 48 48">
          {/* Sparkle top-right */}
          <Path
            d="M 36 8 L 37 10 L 39 11 L 37 12 L 36 14 L 35 12 L 33 11 L 35 10 Z"
            fill="#FBBC04"
          />
          {/* Sparkle bottom-left */}
          <Path
            d="M 12 40 L 13 42 L 15 43 L 13 44 L 12 46 L 11 44 L 9 43 L 11 42 Z"
            fill="#34A853"
          />
          {/* Sparkle top-left */}
          <Path
            d="M 8 12 L 9 13.5 L 10.5 14.5 L 9 15.5 L 8 17 L 7 15.5 L 5.5 14.5 L 7 13.5 Z"
            fill="#4285F4"
          />
          {/* Sparkle bottom-right */}
          <Path
            d="M 40 36 L 41 37.5 L 42.5 38.5 L 41 39.5 L 40 41 L 39 39.5 L 37.5 38.5 L 39 37.5 Z"
            fill="#EA4335"
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}
