module.exports = {
  apps: [
    {
      name: "train-fit-back",
      script: "./bin/www",
      node_args: "--max-old-space-size=350",
      max_memory_restart: "400M",
    }]
}
