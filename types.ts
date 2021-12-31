export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  startDateUtc: string;
  endDateUtc: string;
  duration: number; // minutes
  isRecurring: boolean;
  recurrencePattern: string;
  // allDay: boolean,
  // participants: User[]
}

export interface SetEventParams extends Omit<CalendarEvent, "id"> {
  id?: string;
}
