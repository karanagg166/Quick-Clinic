"use client";
import {useEffect,useRef,useCallback} from "react";
type ThrottledCallback<T extends (...args: any[]) => any> = {   
    (...args: Parameters<T>): void;
    cancel: () => void;
};

export function useThrottledCallback<T extends (...args: any[]) => any>(
    callback: T,
    delay: number
): ThrottledCallback<T> {
    const lastCallRef = useRef<number | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const throttledFunction = useCallback((...args: Parameters<T>) => {
        const now = Date.now();

        if (lastCallRef.current === null || now - lastCallRef.current >= delay) {
            lastCallRef.current = now;
            callback(...args);
        } else {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            const timeRemaining = delay - (now - lastCallRef.current);
            timeoutRef.current = setTimeout(() => {
                lastCallRef.current = Date.now();
                callback(...args);
            }, timeRemaining);
        }
    }, [callback, delay]);

    const cancel = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        lastCallRef.current = null;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        }               
    }, []);
    
    return Object.assign(throttledFunction, { cancel });
}