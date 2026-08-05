/**
 * Two deliberately separate probability thresholds used by SIAGA.
 *
 * The monitoring threshold controls situational-awareness views only.
 * The allocation threshold is the optimizer's eligibility floor and does not
 * mean that every eligible district automatically receives resources.
 */
export const MONITORING_THRESHOLD = 0.5;
export const CRITICAL_ALLOCATION_THRESHOLD = 0.05;

export const MONITORING_THRESHOLD_PERCENT = MONITORING_THRESHOLD * 100;
export const CRITICAL_ALLOCATION_THRESHOLD_PERCENT = CRITICAL_ALLOCATION_THRESHOLD * 100;

export const MONITORING_THRESHOLD_HELP =
  "Peluang bahaya minimal 50% ditandai untuk pemantauan dan kesadaran situasi. Ambang ini tidak memicu alokasi otomatis.";

export const CRITICAL_ALLOCATION_THRESHOLD_HELP =
  "Peluang bahaya minimal 5% membuat kebutuhan layak dipertimbangkan optimizer. Prioritas akhir tetap ditentukan oleh paparan, kapasitas, waktu tempuh, dan risiko kekurangan.";
