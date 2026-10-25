// The Control rooms list is now part of the Live page (each match's desk is on its card).
import { redirect } from 'next/navigation';

export default function ControlRooms() {
  redirect('/app/live');
}
