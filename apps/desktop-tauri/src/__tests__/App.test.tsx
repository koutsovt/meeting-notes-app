import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { App } from "../App.js"

// Mock getUserMedia
const mockStream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream

// Mock MediaRecorder
class MockMediaRecorder {
  state = "inactive"
  start() { this.state = "recording" }
  stop() { this.state = "inactive" }
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder)
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    },
  })
})

describe("App", () => {
  it("shows requesting state then renders app after permission granted", async () => {
    render(<App />)
    expect(screen.getByText("Requesting...")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("meeting notes")).toBeInTheDocument()
      expect(screen.getByText("Granted")).toBeInTheDocument()
    })
  })

  it("shows denied state when mic permission fails", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText("Denied")).toBeInTheDocument()
      expect(screen.getByText(/Permission denied/)).toBeInTheDocument()
    })
  })

  it("shows Start button after permission granted", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("Start")).toBeInTheDocument()
    })
  })

  it("switches to Stop button and Recording badge after starting", async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText("Start")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Start"))
    expect(screen.getByText("Stop")).toBeInTheDocument()
    expect(screen.getByText("Recording")).toBeInTheDocument()
  })

  it("shows Idle status initially", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("Idle")).toBeInTheDocument()
    })
  })

  it("shows empty state when no meetings", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("No meetings yet")).toBeInTheDocument()
    })
  })

  it("shows live transcript panel after starting", async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText("Start")).toBeInTheDocument())
    await user.click(screen.getByText("Start"))
    expect(screen.getByText("Live Transcript")).toBeInTheDocument()
    expect(screen.getByText("Listening...")).toBeInTheDocument()
  })

  it("shows delete button on completed meetings", async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText("Start")).toBeInTheDocument())

    await user.click(screen.getByText("Start"))
    await user.click(screen.getByText("Stop"))

    await waitFor(() => {
      const deleteButtons = screen.getAllByText("×")
      expect(deleteButtons.length).toBeGreaterThan(0)
    })
  })

  it("shows duration 00:00 initially instead of --:--", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("00:00")).toBeInTheDocument()
    })
  })
})
