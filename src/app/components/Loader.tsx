import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

const Loader: React.FC = () => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
      }}
    >
      <CircularProgress
        sx={{
          color: "var(--primary-green)",
        }}
      />
    </Box>
  );
};

export default Loader;
