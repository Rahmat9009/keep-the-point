import { formatTime } from './time';

export function speakerTimesHtml(
  planned: ReadonlyMap<string | undefined, number>,
  actual?: ReadonlyMap<string | undefined, number>,
): string {
  const names = [...new Set([...planned.keys(), ...(actual?.keys() ?? [])])];
  if (!names.length) return '';
  const rows = names.map((name) => `
    <tr>
      <th scope="row" class="rh__card">${esc(name ?? 'Unassigned cards')}</th>
      <td class="num">${formatTime(planned.get(name) ?? 0)}</td>
      ${actual ? `<td class="num">${formatTime(actual.get(name) ?? 0)}</td>` : ''}
    </tr>`);
  return `<table class="rh__table group-times">
    <caption>Time by speaker</caption>
    <thead><tr><th scope="col">Speaker</th><th scope="col" class="num">Planned</th>${actual ? '<th scope="col" class="num">This run</th>' : ''}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
