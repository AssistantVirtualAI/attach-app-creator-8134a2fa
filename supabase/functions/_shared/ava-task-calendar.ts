const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Translate the shared task recurrence into Microsoft's patternedRecurrence. */
export function outlookTaskRecurrence(recurrence: any, startWall: string, timezone = "America/Toronto") {
  if (recurrence == null) return undefined;
  if (!recurrence || typeof recurrence !== "object" || Array.isArray(recurrence)) throw new Error("invalid_recurrence");
  const interval = Number(recurrence.value ?? 1);
  if (!Number.isInteger(interval) || interval < 1) throw new Error("invalid_recurrence_interval");
  const date = startWall.slice(0, 10);
  const reference = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(reference.getTime())) throw new Error("invalid_recurrence_start");
  const pattern: Record<string, unknown> = { interval };
  switch (recurrence.pattern) {
    case "day": pattern.type = "daily"; break;
    case "week": {
      const raw = recurrence.on;
      const days = raw == null ? [reference.getUTCDay()] : Array.isArray(raw) ? raw : [raw];
      if (!days.length || days.some((d: unknown) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) throw new Error("invalid_recurrence_weekdays");
      pattern.type = "weekly";
      pattern.daysOfWeek = [...new Set(days.map((d: unknown) => WEEKDAYS[Number(d)]))];
      pattern.firstDayOfWeek = "sunday";
      break;
    }
    case "month": pattern.type = "absoluteMonthly"; pattern.dayOfMonth = reference.getUTCDate(); break;
    case "year": pattern.type = "absoluteYearly"; pattern.dayOfMonth = reference.getUTCDate(); pattern.month = reference.getUTCMonth() + 1; break;
    default: throw new Error("invalid_recurrence_pattern");
  }
  return { pattern, range: { type: "noEnd", startDate: date, recurrenceTimeZone: timezone } };
}

/** Task creation remains owner-scoped; never retry either external mutation. */
export async function createTaskWithOutlook(
  input: Record<string, any>,
  createTask: (input: Record<string, any>) => Promise<any>,
  createEvent: (input: Record<string, any>) => Promise<any>,
) {
  const task = await createTask(input);
  if (!task?.success || input.link_outlook !== true) return task;
  const taskId = task.task_id ?? task.task?.id;
  if (!taskId) return { ...task, success: false, task_created: true, error: "task_id_missing", message: "Tâche créée; lien Outlook non créé car Maestro n’a pas retourné son identifiant. Ne recrée pas la tâche." };
  let calendar: any;
  try {
    calendar = await createEvent({
      subject: input.notes, start_datetime: input.due_at,
      duration_minutes: input.duration_minutes ?? 30,
      body: `${input.description ?? input.notes}\nMaestro task: ${taskId}`,
      recurrence: input.recurrence, is_online: false,
      transaction_id: `maestro-task-${taskId}`,
      confirmed: input.confirmed === true,
      idempotency_key: `maestro-task-${taskId}:outlook`,
    });
  } catch {
    calendar = { success: false, error: "calendar_result_unconfirmed" };
  }
  if (!calendar?.success) return {
    ...task, success: false, task_created: true, outlook_created: false,
    error: "outlook_link_failed", calendar_error: calendar?.error,
    message: "La tâche est créée dans Maestro, mais le lien Outlook n’est pas confirmé. Ne recrée pas la tâche; vérifie ton calendrier et la connexion Microsoft 365.",
  };
  return { ...task, outlook_created: true, event_id: calendar.event_id, web_link: calendar.web_link, message: "Tâche créée dans Maestro et événement correspondant créé dans Outlook." };
}