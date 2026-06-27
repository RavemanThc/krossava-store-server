export const notFoundPageHandler = (req, res) => {
  res.status(404).json({ message: 'Router notFound' });
};
