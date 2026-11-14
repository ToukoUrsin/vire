import fs from 'node:fs'
const key = process.env.ELEVENLABS_API_KEY
if (!key) throw new Error('ELEVENLABS_API_KEY missing')
const out = 'film/assets/vire-score.mp3'
if (fs.existsSync(out)) process.exit(0)
const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
 method:'POST', headers:{'xi-api-key':key,'content-type':'application/json'},
 body:JSON.stringify({prompt:'Instrumental cinematic product film score, 104 BPM. Start with a sparse low pulse and quiet tension for eight seconds. At fifteen seconds bloom into a warm analog synth arpeggio with soft kick and precise light percussion. Build steadily, with a clear lift at sixty seconds and another at eighty-five seconds. Resolve into a calm warm final chord at one hundred sixteen seconds. Premium, human, hopeful, restrained, no vocals, no sound effects.', music_length_ms:120000, force_instrumental:true})
})
if (!r.ok) throw new Error('music '+r.status+': '+(await r.text()).slice(0,200))
fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
console.log(out)

