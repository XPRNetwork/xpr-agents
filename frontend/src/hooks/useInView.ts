import { useRef, useState, useEffect, useCallback } from 'react';

export function useInView(options?: IntersectionObserverInit): [React.RefCallback<HTMLDivElement>, boolean] {
  const [inView, setInView] = useState(false);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el || inView) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, options]);

  const ref = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node;
  }, []);

  return [ref, inView];
}
