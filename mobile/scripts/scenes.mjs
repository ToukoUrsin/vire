// The passes through the app that the film is cut from. Each one records the real app, driven by taps and scrolls.
export const SCENES = {
  // the day ring draws, then the three signals are picked one after the other
  today: {
    async run(a) {
      await a.open('/you')
      a.start()
      await a.go('/today')
      await a.wait(3600)
      await a.tap('.sig:nth-child(3)')
      await a.wait(1500)
      // up to the sentence the day ends in
      await a.scroll(250, 1100)
      await a.wait(2300)
      await a.tap('.sig:nth-child(2)')
      await a.wait(1600)
      a.stop()
    },
  },
  // the You tab arrives, the three things it learns, then the button
  teach: {
    async run(a) {
      await a.open('/today')
      a.start()
      await a.wait(250)
      await a.tap('.tab:nth-child(5)')
      await a.wait(8300)
      await a.tapText('Teach them')
      await a.wait(1400)
      a.stop()
    },
  },
  calls: {
    async run(a) {
      await a.open('/signals')
      a.start()
      await a.wait(100)
      await a.go('/signals/calls')
      await a.wait(2300)
      await a.tapText('Wed').catch(() => console.log('no Wed'))
      await a.wait(1500)
      await a.tapText('Today').catch(() => console.log('no Today'))
      await a.wait(1300)
      a.stop()
    },
  },
  music: {
    async run(a) {
      await a.open('/signals')
      a.start()
      await a.wait(100)
      await a.go('/signals/music')
      await a.wait(2100)
      await a.tapText('11:41').catch(() => console.log('no 11:41'))
      await a.wait(1500)
      await a.tapText('11:20').catch(() => console.log('no 11:20'))
      await a.wait(1500)
      a.stop()
    },
  },
  sleep: {
    async run(a) {
      await a.open('/signals')
      a.start()
      await a.wait(100)
      await a.go('/signals/sleep')
      await a.wait(1900)
      await a.drag([[70, 400], [200, 395], [335, 400]], 2200).catch(() => console.log('no drag'))
      await a.wait(900)
      a.stop()
    },
  },
  // the practices, then slow breathing from Begin to its result
  practice: {
    async run(a) {
      await a.open('/practices')
      a.start()
      await a.wait(900)
      await a.tapText('Slow breathing')
      await a.wait(1150)
      await a.tapText('1 min')
      await a.wait(380)
      await a.tapText('Begin')
      await a.wait(7000)
      a.stop()
    },
  },
  // the same practice run to its end, so the result is a finished one: only the last breaths and the result are kept
  result: {
    async run(a) {
      await a.open('/practice/breathing')
      await a.tapText('1 min')
      await a.wait(450)
      await a.tapText('Begin')
      await a.wait(51500)
      a.start()
      await a.wait(14500)
      a.stop()
    },
  },
  // the nurse's chat, then what the clinic sees and the booster
  care: {
    async run(a) {
      await a.open('/today')
      a.start()
      await a.wait(150)
      await a.tap('.tab:nth-child(4)')
      // the chat opens at its newest message, so there is nothing to scroll to
      await a.wait(4400)
      await a.go('/care/clinic')
      await a.wait(900)
      await a.scroll(430, 1000)
      await a.wait(600)
      await a.tapText('Book it')
      await a.wait(3000)
      a.stop()
    },
  },
  research: {
    async run(a) {
      await a.open('/you')
      a.start()
      await a.wait(200)
      await a.tapText('The evidence')
      await a.wait(2100)
      await a.scroll(330, 2600)
      await a.wait(600)
      a.stop()
    },
  },
}
