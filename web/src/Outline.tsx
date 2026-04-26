import './Outline.css';

function Outline(props: { children: React.ReactNode }) {
  return <div className='Outline'>{props.children}</div>;
}

export default Outline;
