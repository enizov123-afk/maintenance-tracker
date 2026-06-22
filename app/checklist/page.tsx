import { redirect } from 'next/navigation'

// Страница отметки работ перенесена в карточку оборудования (/equipment/[id]).
// Этот файл оставлен временно как редирект — удали папку app/checklist целиком
// командой `rm -rf app/checklist`, когда будешь у терминала (песочница не может
// удалить эти файлы из-за прав на смонтированную папку).
export default function ChecklistRedirect() {
  redirect('/equipment')
}
