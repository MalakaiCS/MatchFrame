// The Producer board is now part of the Live page.
import { redirect } from 'next/navigation';

export default function ProducerBoard() {
  redirect('/app/live');
}
