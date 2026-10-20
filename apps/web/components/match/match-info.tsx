'use client';
// Match information the graphics use: officials, attendance and weather. Saved on the match; the officials and
// weather graphics read it straight away.
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, ErrorNotice, Field, Input, NativeSelect } from '@bs/ui';
import { patch } from '@/lib/api';
import { useAction } from '@/lib/hooks';

interface Official { role: string; name: string }
interface Weather { summary?: string | null; tempC?: number | null; condition?: string | null }
const ROLES: Record<string, string> = { referee: 'Referee', assistant_1: 'Assistant 1', assistant_2: 'Assistant 2', fourth: 'Fourth official', video: 'Video official', umpire: 'Umpire', touch_judge: 'Touch judge', other: 'Other' };
const CONDITIONS: Record<string, string> = { sunny: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', wind: 'Windy', storm: 'Storm', snow: 'Snow', indoor: 'Indoor' };

export function MatchInfoEditor({ matchId, match, canEdit }: { matchId: string; match: { officials?: Official[] | null; attendance?: number | null; weather?: Weather | null }; canEdit: boolean }) {
  const [officials, setOfficials] = useState<Official[]>(match.officials ?? []);
  const [attendance, setAttendance] = useState(match.attendance == null ? '' : String(match.attendance));
  const [weather, setWeather] = useState<Weather>(match.weather ?? {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setOfficials(match.officials ?? []);
    setAttendance(match.attendance == null ? '' : String(match.attendance));
    setWeather(match.weather ?? {});
  }, [match.officials, match.attendance, match.weather, dirty]);
  const save = useAction(() => patch(`matches/${matchId}`, { officials: officials.filter((o) => o.name.trim()).map((o) => ({ role: o.role, name: o.name.trim() })), attendance: attendance.trim() ? Number(attendance) : null, weather: weather.summary || weather.tempC != null || weather.condition ? { summary: weather.summary || null, tempC: weather.tempC ?? null, condition: weather.condition || null } : null }), [['match', matchId]], { success: 'Match information saved' });
  const touch = () => setDirty(true);
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Match information</h2>
      <p className="mb-3 text-xs text-muted">Officials, attendance and weather feed the match information graphics and the public match centre.</p>
      <div className="grid gap-3">
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted">Officials</h3>
          <div className="grid gap-2">
            {officials.map((o, i) => (
              <div key={i} className="flex gap-2">
                <NativeSelect aria-label="Role" className="w-40" disabled={!canEdit} value={o.role} onChange={(e) => { touch(); setOfficials(officials.map((x, j) => (j === i ? { ...x, role: e.target.value } : x))); }}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
                <Input aria-label="Name" className="flex-1" disabled={!canEdit} value={o.name} maxLength={80} onChange={(e) => { touch(); setOfficials(officials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); }} />
                {canEdit ? <Button variant="ghost" size="md" aria-label="Remove official" onClick={() => { touch(); setOfficials(officials.filter((_, j) => j !== i)); }}><Trash2 className="size-4" /></Button> : null}
              </div>
            ))}
            {canEdit && officials.length < 12 ? <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => { touch(); setOfficials([...officials, { role: officials.length ? 'assistant_1' : 'referee', name: '' }]); }}><Plus className="size-4" /> Add official</Button> : null}
            {!officials.length && !canEdit ? <p className="text-sm text-muted">Not entered.</p> : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Attendance" htmlFor="mi-att"><Input id="mi-att" inputMode="numeric" disabled={!canEdit} value={attendance} onChange={(e) => { touch(); setAttendance(e.target.value.replace(/\D/g, '')); }} /></Field>
          <Field label="Weather" htmlFor="mi-w"><NativeSelect id="mi-w" disabled={!canEdit} value={weather.condition ?? ''} onChange={(e) => { touch(); setWeather({ ...weather, condition: e.target.value || null }); }}><option value="">Not set</option>{Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
          <Field label="Temperature (°C)" htmlFor="mi-t"><Input id="mi-t" inputMode="decimal" disabled={!canEdit} value={weather.tempC == null ? '' : String(weather.tempC)} onChange={(e) => { touch(); setWeather({ ...weather, tempC: e.target.value.trim() === '' ? null : Number(e.target.value) }); }} /></Field>
        </div>
        <Field label="Weather note" htmlFor="mi-s" hint="Short, e.g. “Light rain, strong northerly”"><Input id="mi-s" disabled={!canEdit} maxLength={60} value={weather.summary ?? ''} onChange={(e) => { touch(); setWeather({ ...weather, summary: e.target.value }); }} /></Field>
        {canEdit ? <div className="flex items-center gap-2"><Button variant="primary" size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(undefined, { onSuccess: () => setDirty(false) })}>Save match information</Button>{dirty ? <span className="text-xs text-warning">Unsaved changes</span> : null}</div> : null}
        <ErrorNotice error={save.error} />
      </div>
    </Card>
  );
}
