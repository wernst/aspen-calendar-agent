import { Agent, Log } from "@aspen.cloud/agent-typings";

enum Operations {
  SET_EVENT = "SET_EVENT",
  DELETE_EVENT = "DELETE_EVENT",
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  dateUtc: string;
  duration: number; // minutes
  // allDay: boolean,
  // participants: User[]
}

interface SetEventParams {
  id?: string;
  title: string;
  description: string;
  dateUtc: string;
  duration: string; // minutes
}

const NOTIFICATION_OFFSET = 30;

function getEventsByYearFilter(year: string) {
  return (event: CalendarEvent) => {
    const parsedDate = new Date(event.dateUtc);
    return parsedDate.getFullYear().toString() === year;
  };
}

function getEventsByYearMonthFilter(year: string, month: string) {
  return (event: CalendarEvent) => {
    const parsedDate = new Date(event.dateUtc);
    return (
      getEventsByYearFilter(year)(event) &&
      parsedDate.getMonth().toString() === month
    );
  };
}

function getEventsByYearMonthDayFilter(
  year: string,
  month: string,
  day: string
) {
  return (event: CalendarEvent) => {
    const parsedDate = new Date(event.dateUtc);
    return (
      getEventsByYearMonthFilter(year, month)(event) &&
      parsedDate.getDate().toString() === day
    );
  };
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
      const events = await aspen.getAggregation("events", {
        range: "continuous",
      });
      return Object.values(events).filter(
        getEventsByYearMonthDayFilter(year, month, day)
      );
    },
    eventsForMonth: async (params: { year: string; month: string }, aspen) => {
      const { year, month } = params;
      const events = await aspen.getAggregation("events", {
        range: "continuous",
      });
      return Object.values(events).filter(
        getEventsByYearMonthFilter(year, month)
      );
    },
    eventsForYear: async (params: { year: string }, aspen) => {
      const { year } = params;
      const events = await aspen.getAggregation("events", {
        range: "continuous",
      });
      return Object.values(events).filter(getEventsByYearFilter(year));
    },
  },
  actions: {
    setEvent: async (params: SetEventParams, aspen) => {
      const { title, description, dateUtc, duration, id } = params;
      const parsedDate = new Date(dateUtc);
      const rid = id ?? (await aspen.createResource());
      const event = {
        title,
        description,
        dateUtc: parsedDate,
        duration,
        id: rid,
      };
      await aspen.pushEvent(
        Operations.SET_EVENT,
        { event },
        {
          resourceId: rid,
        }
      );
      const notifyDate = new Date(
        parsedDate.getTime() - NOTIFICATION_OFFSET * 60 * 1000
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
