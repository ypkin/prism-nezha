import { useRef, type TouchEvent } from "react"

/**
 * iOS-style edge swipe back: a rightward swipe that starts within 28px
 * of the left edge and travels at least 64px mostly horizontally calls
 * onBack. Spread the returned handlers onto the view's root element.
 * Starting at the edge keeps it clear of chart brushes and other
 * horizontal drags inside the view.
 */
export function useEdgeSwipeBack(onBack: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0]
      start.current = touch && touch.clientX <= 28 ? { x: touch.clientX, y: touch.clientY } : null
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const from = start.current
      if (!from) return
      const touch = event.touches[0]
      if (!touch) return
      const dx = touch.clientX - from.x
      const dy = Math.abs(touch.clientY - from.y)
      if (dx >= 64 && dy <= 48 && dx > dy * 1.6) {
        start.current = null
        onBack()
      }
    },
  }
}
