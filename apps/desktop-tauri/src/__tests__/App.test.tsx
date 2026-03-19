import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("App", () => {
  it("shows requesting state then renders app after permission granted", async () => {
    render(<App />)
    expect(screen.getByText("Requesting microphone")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("Synolo")).toBeInTheDocument()
      expect(screen.getByText("Granted")).toBeInTheDocument()
    })
  })

  it("shows error when mic permission fails", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")),
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument()
    })
  })

  it("shows start button after permission granted", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument()
    })
  })

  it("switches to stop button and Recording status after starting", async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /start/i }))
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument()
    expect(screen.getByText("Recording")).toBeInTheDocument()
  })

  it("shows Ready status initially", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument())
    await user.click(screen.getByRole("button", { name: /start/i }))
    expect(screen.getByText("Live Transcript")).toBeInTheDocument()
    expect(screen.getByText("Listening...")).toBeInTheDocument()
  })

  it("shows delete button on completed meetings", async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument())

    await user.click(screen.getByRole("button", { name: /start/i }))
    await user.click(screen.getByRole("button", { name: /stop/i }))

    await waitFor(() => {
      const svgButtons = screen.getAllByRole("button")
      const deleteBtn = svgButtons.find((btn) => btn.classList.contains("btn-icon"))
      expect(deleteBtn).toBeTruthy()
    })
  })

  it("shows duration 00:00 initially instead of --:--", async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText("00:00")).toBeInTheDocument()
    })
  })
})
