import { Agent, Log } from "@aspen.cloud/agent-typings";
import {
  addDays,
  addMinutes,
  addMonths,
  addYears,
  isAfter,
  isBefore,
} from "date-fns";
import { rrulestr } from "rrule";

enum Operations {
  SET_EVENT = "SET_EVENT",
  DELETE_EVENT = "DELETE_EVENT",
}

interface CalendarEvent {
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

interface SetEventParams {
  id?: string;
  title: string;
  description: string;
  startDateUtc: string;
  endDateUtc: string;
  duration: string; // minutes
  isRecurring: boolean;
  recurrencePattern: string;
}

const NOTIFICATION_OFFSET = 30;

function eventRangeFilter(startDateUtc: string, endDateUtc: string) {
  const rangeStart = new Date(startDateUtc);
  const rangeEnd = new Date(endDateUtc);
  return (event: CalendarEvent) => {
    const eventStart = new Date(event.startDateUtc);
    const eventEnd = new Date(event.endDateUtc);
    return isBefore(rangeStart, eventEnd) && isAfter(rangeEnd, eventStart);
  };
}

function generateRecurringEvents(
  event: CalendarEvent,
  startDateUtc: string,
  endDateUtc: string
) {
  const rule = rrulestr(event.recurrencePattern);
  const dates = rule.between(new Date(startDateUtc), new Date(endDateUtc));
  return dates.map<CalendarEvent>((date) => ({
    ...event,
    startDateUtc: date.toISOString(),
    endDateUtc: addMinutes(date, event.duration).toISOString(),
  }));
}

function parseEvents(
  events: CalendarEvent[],
  startDateUtc: string,
  endDateUtc: string
) {
  const nonRecurring = events.filter((e) => !e.isRecurring);
  const recurring = events
    .filter((e) => e.isRecurring)
    .flatMap((event) =>
      generateRecurringEvents(event, startDateUtc, endDateUtc)
    );

  return [...nonRecurring, ...recurring];
}

const agent: Agent = {
  aggregations: {
    events: {
      initialize: (calendarData?: Record<string, CalendarEvent>) => {
        return calendarData ?? {};
      },
      reducer: (
        calendarData: Record<string, CalendarEvent>,
        event: Log<any>
      ) => {
        switch (event.data.type) {
          case Operations.SET_EVENT:
            calendarData[event.data.event.id] = event.data.event;
            break;
          case Operations.DELETE_EVENT:
            delete calendarData[event.data.eventId];
            break;
        }
        return { ...calendarData };
      },
      serialize: (calendarData: Record<string, CalendarEvent>) => {
        return calendarData;
      },
    },
  },
  views: {
    eventsForDate: async (
      params: { year: string; month: string; day: string },
      aspen
    ) => {
      const { year, month, day } = params;
      const events = (await aspen.getAggregation("events", {
        range: "continuous",
      })) as Record<string, CalendarEvent>;

      const startDate = new Date(Number(year), Number(month), Number(day));
      const startDateUtc = startDate.toISOString();
      const endDate = addDays(startDate, 1);
      const endDateUtc = endDate.toISOString();
      const eventsInRange = Object.values(events).filter(
        eventRangeFilter(startDateUtc, endDateUtc)
      );
      return parseEvents(eventsInRange, startDateUtc, endDateUtc);
    },
    eventsForMonth: async (params: { year: string; month: string }, aspen) => {
      const { year, month } = params;
      const events = (await aspen.getAggregation("events", {
        range: "continuous",
      })) as Record<string, CalendarEvent>;

      const startDate = new Date(Number(year), Number(month));
      const startDateUtc = startDate.toISOString();
      const endDate = addMonths(startDate, 1);
      const endDateUtc = endDate.toISOString();
      const eventsInRange = Object.values(events).filter(
        eventRangeFilter(startDateUtc, endDateUtc)
      );
      return parseEvents(eventsInRange, startDateUtc, endDateUtc);
    },
    eventsForYear: async (params: { year: string }, aspen) => {
      const { year } = params;
      const events = (await aspen.getAggregation("events", {
        range: "continuous",
      })) as Record<string, CalendarEvent>;
      const startDate = new Date(Number(year));
      const startDateUtc = startDate.toISOString();
      const endDate = addYears(startDate, 1);
      const endDateUtc = endDate.toISOString();
      const eventsInRange = Object.values(events).filter(
        eventRangeFilter(startDateUtc, endDateUtc)
      );
      return parseEvents(eventsInRange, startDateUtc, endDateUtc);
    },
    eventsInRange: async (
      params: { startDateUtc: string; endDateUtc: string },
      aspen
    ) => {
      const { startDateUtc, endDateUtc } = params;
      const events = (await aspen.getAggregation("events", {
        range: "continuous",
      })) as Record<string, CalendarEvent>;
      return Object.values(events).filter(
        eventRangeFilter(startDateUtc, endDateUtc)
      );
    },
  },
  actions: {
    setEvent: async (params: SetEventParams, aspen) => {
      const {
        title,
        description,
        startDateUtc,
        endDateUtc,
        duration,
        id,
        isRecurring,
        recurrencePattern,
      } = params;
      const rid = id ?? (await aspen.createResource());
      const event = {
        title,
        description,
        startDateUtc,
        endDateUtc,
        duration: Number(duration),
        id: rid,
        isRecurring,
        recurrencePattern,
      } as CalendarEvent;
      await aspen.pushEvent(
        Operations.SET_EVENT,
        { event },
        {
          resourceId: rid,
        }
      );
      const startDate = new Date(startDateUtc);
      const notifyDate = new Date(
        startDate.getTime() - NOTIFICATION_OFFSET * 60 * 1000
      );
      aspen.scheduleAction("notify", event, notifyDate, {
        jobKey: `reminder_${rid}`,
      });
      return event;
    },
    deleteEvent: async (params, aspen) => {
      await aspen.pushEvent(Operations.DELETE_EVENT, {
        eventId: params.eventId,
      });
      aspen.unscheduleAction(`reminder_${params.eventId}`);
      return params.eventId;
    },
    notify: async (params, aspen) => {
      log(`UPCOMING EVENT: ${JSON.stringify(params)}`);
      return "notified";
    },
  },
};

export default agent;
