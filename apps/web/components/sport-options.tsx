import { SPORTS, SPORT_LABELS } from '@bs/domain';

/** The six supported codes as <option>s, so every sport picker lists the same set in the same order. */
export function SportOptions() {
  return (
    <>
      {SPORTS.map((s) => (
        <option key={s} value={s}>{SPORT_LABELS[s]}</option>
      ))}
    </>
  );
}
