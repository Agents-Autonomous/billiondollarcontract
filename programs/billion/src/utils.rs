use crate::state::GRID_SIZE;

/// Calculate which ring a block belongs to (1-10)
/// Ring 1 is outermost (corners), Ring 10 is center
/// Outer rings unlock first, center unlocks last
pub fn get_ring(x: u8, y: u8) -> u8 {
    let center = (GRID_SIZE / 2) as i16; // 50
    let dx = ((x as i16) - center).unsigned_abs() as u8;
    let dy = ((y as i16) - center).unsigned_abs() as u8;
    let distance = dx.max(dy);

    // Ring 10 = center (0-4), Ring 1 = corners (45-50)
    // Inverted: 11 - ((distance / 5) + 1), clamped to 1-10
    let raw_ring = (distance / 5) + 1;
    (11 - raw_ring.min(10)).max(1)
}

/// Calculate which ring is unlocked based on total burned
pub fn get_unlocked_ring(total_burned: u64, thresholds: &[u64]) -> u8 {
    for (i, &threshold) in thresholds.iter().enumerate().rev() {
        if total_burned >= threshold {
            return (i + 1) as u8;
        }
    }
    1 // Ring 1 always unlocked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_ring_center() {
        // Center area (distance 0-4 from center) = Ring 10 (unlocks last)
        assert_eq!(get_ring(50, 50), 10);
        assert_eq!(get_ring(48, 52), 10);
        assert_eq!(get_ring(54, 46), 10);
    }

    #[test]
    fn test_get_ring_edges() {
        // Corners/edges (distance 45-50 from center) = Ring 1 (unlocks first)
        assert_eq!(get_ring(0, 0), 1);
        assert_eq!(get_ring(99, 99), 1);
        assert_eq!(get_ring(0, 99), 1);
        assert_eq!(get_ring(99, 0), 1);
    }

    #[test]
    fn test_get_ring_boundaries() {
        // Ring boundaries based on distance from center
        assert_eq!(get_ring(50, 54), 10); // distance 4 → Ring 10
        assert_eq!(get_ring(50, 55), 9);  // distance 5 → Ring 9
        assert_eq!(get_ring(50, 59), 9);  // distance 9 → Ring 9
        assert_eq!(get_ring(50, 60), 8);  // distance 10 → Ring 8
    }

    #[test]
    fn test_get_unlocked_ring() {
        let thresholds = vec![0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
        assert_eq!(get_unlocked_ring(0, &thresholds), 1);
        assert_eq!(get_unlocked_ring(99, &thresholds), 1);
        assert_eq!(get_unlocked_ring(100, &thresholds), 2);
        assert_eq!(get_unlocked_ring(500, &thresholds), 6);
        assert_eq!(get_unlocked_ring(1000, &thresholds), 10);
    }
}
