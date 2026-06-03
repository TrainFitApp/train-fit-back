module.exports = {
  apps: [
    {
      name: "train-fit-back",
      script: "./bin/www",
      // highlight-next-line
      max_memory_restart: "400M",
    }]
}
